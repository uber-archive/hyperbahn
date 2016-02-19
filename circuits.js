// Copyright (c) 2015 Uber Technologies, Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

'use strict';

var assert = require('assert');
var format = require('util').format;
var inherits = require('util').inherits;

var clean = require('tchannel/lib/statsd').clean;
var errors = require('tchannel/errors');

//  circuit = circuits                        : Circuits
//      .circuitsByServiceName[serviceName]   : ServiceCircuits
//      .circuitsByCallerName[callerName]     : EndpointCircuits
//      .circuitsByEndpointName[endpointName]

function EndpointCircuits(root) {
    this.root = root;
    this.circuitsByEndpointName = {};
}

EndpointCircuits.prototype.updateShorts = function updateShorts(shorts) {
    var keys = Object.keys(this.circuitsByEndpointName);
    for (var i = 0; i < keys.length; ++i) {
        this.circuitsByEndpointName[keys[i]].updateShorted();
    }
};

EndpointCircuits.prototype.getCircuit = function getCircuit(callerName, serviceName, endpointName) {
    var circuit = this.circuitsByEndpointName['$' + endpointName];
    if (!circuit) {
        circuit = new Circuit(this.root, callerName, serviceName, endpointName);
        this.circuitsByEndpointName['$' + endpointName] = circuit;
    }
    return circuit;
};

EndpointCircuits.prototype.collectCircuitTuples = function collectCircuitTuples(tuples) {
    var endpointNames = Object.keys(this.circuitsByEndpointName);
    for (var index = 0; index < endpointNames.length; index++) {
        var endpointName = endpointNames[index];
        var circuit = this.circuitsByEndpointName[endpointName];
        tuples.push([circuit.callerName, circuit.serviceName, circuit.endpointName]);
    }
};

function ServiceCircuits(root) {
    this.root = root;
    this.circuitsByCallerName = {};
}

ServiceCircuits.prototype.updateShorts = function updateShorts(shorts) {
    var keys = Object.keys(this.circuitsByCallerName);
    for (var i = 0; i < keys.length; ++i) {
        this.circuitsByCallerName[keys[i]].updateShorts(shorts);
    }
};

ServiceCircuits.prototype.getCircuit = function getCircuit(callerName, serviceName, endpointName) {
    var circuits = this.circuitsByCallerName['$' + callerName];
    if (!circuits) {
        circuits = new EndpointCircuits(this.root);
        this.circuitsByCallerName['$' + callerName] = circuits;
    }
    return circuits.getCircuit(callerName, serviceName, endpointName);
};

ServiceCircuits.prototype.collectCircuitTuples = function collectCircuitTuples(tuples) {
    var callerNames = Object.keys(this.circuitsByCallerName);
    for (var index = 0; index < callerNames.length; index++) {
        var callerName = callerNames[index];
        var circuit = this.circuitsByCallerName[callerName];
        circuit.collectCircuitTuples(tuples);
    }
};

function Circuits(options) {
    this.logger = options.logger;
    this.statsd = options.statsd;
    this.circuitsByServiceName = {};
    this.config = options.config || {};
    this.shorts = options.shorts;
    this.codeName = options.codeName;

    this.stateOptions = new StateOptions(null, {
        timeHeap: options.timeHeap,
        timers: options.timers,
        random: options.random,
        period: this.config.period,
        maxErrorRate: this.config.maxErrorRate,
        minRequests: this.config.minRequests,
        probation: this.config.probation
    });
    this.egressNodes = options.egressNodes;
}

Circuits.prototype.updateCodeName = function updateCodeName(codeName) {
    this.codeName = codeName;
};

Circuits.prototype.updateShorts = function updateShorts(shorts) {
    this.shorts = parseShorts(shorts);
    var keys = Object.keys(this.circuitsByServiceName);
    for (var i = 0; i < keys.length; ++i) {
        this.circuitsByServiceName[keys[i]].updateShorts();
    }
};

Circuits.prototype.isShorted = function isShorted(callerName, serviceName, endpointName) {
    if (!this.shorts) {
        return false;
    }

    var byService = this.shorts[callerName] || this.shorts['*'];
    if (!byService) {
        return false;
    }

    var byEndpoint = byService[serviceName] || byService['*'];
    if (!byEndpoint) {
        return false;
    }

    return byEndpoint[endpointName] ? true : false;
};

Circuits.prototype.getCircuit = function getCircuit(callerName, serviceName, endpointName) {
    var circuits = this.circuitsByServiceName['$' + serviceName];
    if (!circuits) {
        circuits = new ServiceCircuits(this);
        this.circuitsByServiceName['$' + serviceName] = circuits;
    }
    return circuits.getCircuit(callerName, serviceName, endpointName);
};

Circuits.prototype.getCircuitTuples = function getCircuitTuples() {
    var tuples = [];
    var serviceNames = Object.keys(this.circuitsByServiceName);
    for (var index = 0; index < serviceNames.length; index++) {
        var serviceName = serviceNames[index];
        this.circuitsByServiceName[serviceName].collectCircuitTuples(tuples);
    }
    return tuples;
};

function ErrorFrame(codeName, message) {
    this.codeName = codeName;
    this.message = message;
}

// Called upon membership change to collect services that the corresponding
// exit node is no longer responsible for.
Circuits.prototype.updateServices = function updateServices() {
    var serviceNames = Object.keys(this.circuitsByServiceName);
    for (var index = 0; index < serviceNames.length; index++) {
        var serviceName = serviceNames[index];
        if (!this.egressNodes.isExitFor(serviceName)) {
            delete this.circuitsByServiceName[serviceName];
        }
    }
};

function Circuit(root, callerName, serviceName, endpointName) {
    this.root = root;
    this.state = null;
    this.stateOptions = new StateOptions(this, this.root.stateOptions);
    this.shorted = false;

    this.callerName = callerName || 'no-cn';
    this.serviceName = serviceName;
    this.endpointName = endpointName;
    this.byCallerStatSuffix =
        '.by-caller.' +
        clean(this.callerName) + '.' +
        clean(this.serviceName) + '.' +
        clean(this.endpointName);
    this.byServiceStatSuffix =
        '.by-service.' +
        clean(this.callerName) + '.' +
        clean(this.serviceName) + '.' +
        clean(this.endpointName);

    this.setState(HealthyState);
    this.updateShorted();
}

Circuit.prototype.updateShorted = function updateShorted() {
    this.shorted = this.root.isShorted(this.callerName, this.serviceName, this.endpointName);
};

Circuit.prototype.setState = function setState(StateType) {
    var currentType = this.state && this.state.type;
    if (currentType &&
        StateType.prototype.type &&
        StateType.prototype.type === currentType) {
        return null;
    }

    assert(this.stateOptions, 'state machine must have stateOptions');
    var state = new StateType(this.stateOptions);
    if (state && state.type === currentType) {
        return null;
    }

    var oldState = this.state;
    this.state = state;
    if (oldState) {
        oldState.onDeactivate();
    }

    var statsPrefix = 'circuits.' + state.name;
    this.root.statsd.increment(statsPrefix + '.total', 1);
    this.root.statsd.increment(statsPrefix + this.byCallerStatSuffix, 1);
    this.root.statsd.increment(statsPrefix + this.byServiceStatSuffix, 1);
    this.root.logger.info('circuit event: ' + state.name, this.extendLogInfo({
        oldState: oldState ? oldState.type : 'none',
        state: state ? state.type : 'none'
    }));

    return state;
};

Circuit.prototype.extendLogInfo = function extendLogInfo(info) {
    info.callerName = this.callerName;
    info.serviceName = this.serviceName;
    info.endpointName = this.endpointName;
    return info;
};

module.exports = Circuits;

function StateOptions(circuit, options) {
    options = options || {};
    // for setState changes
    this.circuit = circuit;
    // for mocking tests
    this.timers = options.timers;
    this.timeHeap = options.timeHeap;
    this.random = options.random;
    // the number of miliseconds that healthy and unhealthy requests are
    // tracked between state reevaluation.
    this.period = options.period;
    // when healthy, the minimum number of requests during a period to trigger
    // state reevaluation.
    this.minimumRequests = options.minimumRequests;
    // when healthy, the failure rate for a period that will trigger a
    // transition to unhealthy.
    this.maxErrorRate = options.maxErrorRate;
    // when unhealthy, allow one request per period. this is the number of
    // consecutive periods that must have 100% healthy responses to trigger a
    // switch back to healthy.
    this.probation = options.probation;
}

function PeriodicState(options) {
    this.circuit = options.circuit;
    this.timers = options.timers;
    this.timeHeap = options.timeHeap;
    this.random = options.random;

    this.period = options.period || 1000; // ms
    this.start = 0;
    this.timeout = 0;
    this.periodTimer = null;

    this.startNewPeriod(this.timers.now());
}

PeriodicState.prototype.onDeactivate = function onDeactivate() {
    if (this.periodTimer) {
        this.periodTimer.cancel();
        this.periodTimer = null;
    }
};

PeriodicState.prototype.onRequest = function onRequest(/* req */) {
};

PeriodicState.prototype.onRequestHealthy = function onRequestHealthy() {
};

PeriodicState.prototype.onRequestUnhealthy = function onRequestUnhealthy() {
};

PeriodicState.prototype.onRequestError = function onRequestError() {
};

PeriodicState.prototype.close = function close(callback) {
    callback(null);
};

PeriodicState.prototype.invalidate = function invalidate() {
    if (this.circuit.invalidateScore) {
        this.circuit.invalidateScore();
    }
};

PeriodicState.prototype.startNewPeriod = function startNewPeriod(now) {
    this.start = now;
    if (this.onNewPeriod()) {
        this.setPeriodTimer(this.period, now);
    }
};

PeriodicState.prototype.setPeriodTimer = function setPeriodTimer(timeout, now) {
    if (this.periodTimer) {
        this.periodTimer.cancel();
        this.periodTimer = null;
    }

    this.timeout = timeout;
    this.periodTimer = this.timeHeap.update(this, now);
};

PeriodicState.prototype.onTimeout = function onTimeout() {
    var now = this.timers.now();
    var elapsed = now - this.start;
    var remain = this.period - elapsed;
    if (remain <= 0) {
        this.startNewPeriod(now);
    } else {
        this.setPeriodTimer(remain, now);
    }
};

PeriodicState.prototype.checkPeriod = function checkPeriod(now) {
    var elapsed = now - this.start;
    var remain = this.period - elapsed;
    if (remain <= 0) {
        this.startNewPeriod(now);
        return true;
    }
    return false;
};

PeriodicState.prototype.getRequestError = function getRequestError() {
    if (this.shouldRequest()) {
        return null;
    }

    return new ErrorFrame(this.circuit.root.codeName, 'Service is not healthy');
};

function HealthyState(options) {
    PeriodicState.call(this, options);

    this.maxErrorRate = options.maxErrorRate || 0.5;
    this.healthyCount = 0;
    this.unhealthyCount = 0;
    this.totalRequests = 0;
    this.minRequests = typeof options.minRequests === 'number' ?
        options.minRequests : 5;
}

inherits(HealthyState, PeriodicState);

HealthyState.prototype.type = 'tchannel.healthy';
HealthyState.prototype.name = 'healthy';
HealthyState.prototype.healthy = true;

HealthyState.prototype.toString = function healthyToString() {
    return format('[Healthy %s healthy %s unhealthy]', this.healthyCount, this.unhealthyCount);
};

HealthyState.prototype.shouldRequest = function shouldRequest() {
    var now = this.timers.now();

    this.checkPeriod(now);

    // active unless .onNewPeriod transitioned
    if (this.circuit.state !== this) {
        return this.circuit.state.shouldRequest();
    }

    return true;
};

HealthyState.prototype.onNewPeriod = function onNewPeriod(now) {
    var totalCount = this.healthyCount + this.unhealthyCount;

    // TODO: could store on this for introspection, maybe call it
    // "lastPeriodErrorRate"?; we could even keep a fixed size sample of error
    // rates from periods and choose based on their differences (discrete
    // derivative)...
    var errorRate = this.unhealthyCount / totalCount;

    if (errorRate > this.maxErrorRate &&
        this.totalRequests > this.minRequests) {
        // Transition to unhealthy state if the healthy request rate dips below
        // the acceptable threshold.
        this.circuit.setState(this.circuit.shorted ? ShortedState : UnhealthyState);
        // TODO: useful to mark this dead somehow? for now we're just using "am
        // I still the current state" logic coupled to the consuming
        // circuit in .shouldRequest
    } else {
        // okay last period, reset counts for the new period
        this.healthyCount = 0;
        this.unhealthyCount = 0;
    }

    return false;
};

HealthyState.prototype.onRequest = function onRequest(/* req */) {
    this.invalidate();
};

HealthyState.prototype.onRequestHealthy = function onRequestHealthy() {
    ++this.healthyCount;
    ++this.totalRequests;
    if (!this.checkPeriod(this.timers.now())) {
        this.invalidate();
    }
};

HealthyState.prototype.onRequestUnhealthy = function onRequestUnhealthy() {
    ++this.totalRequests;
    ++this.unhealthyCount;
    if (!this.checkPeriod(this.timers.now())) {
        this.invalidate();
    }
};

HealthyState.prototype.onRequestError = function onRequestError(err) {
    ++this.totalRequests;
    var codeString = errors.classify(err);
    if (errors.isUnhealthy(codeString)) {
        ++this.unhealthyCount;
    } else {
        ++this.healthyCount;
    }
    if (!this.checkPeriod(this.timers.now())) {
        this.invalidate();
    }
};

function UnhealthyState(options) {
    PeriodicState.call(this, options);

    this.minResponseCount = options.probation || 5;
    this.healthyCount = 0;
    this.triedThisPeriod = true;
}

inherits(UnhealthyState, PeriodicState);

UnhealthyState.prototype.type = 'tchannel.unhealthy';
UnhealthyState.prototype.name = 'unhealthy';
UnhealthyState.prototype.healthy = false;

UnhealthyState.prototype.onNewPeriod = function onNewPeriod(now) {
    if (this.healthyCount >= this.minResponseCount) {
        this.circuit.setState(HealthyState);
        return false;
    }

    var triedLastPeriod = this.triedThisPeriod;
    this.triedThisPeriod = false;

    if (triedLastPeriod) {
        // score only changes if we had gone back to "closed" state, otherwise
        // we simply are remaining "open" for a single probe
        this.invalidate();
    }

    return false;
};

UnhealthyState.prototype.toString = function healthyToString() {
    return format('[Unhealthy %s consecutive healthy requests]', this.healthyCount);
};

UnhealthyState.prototype.shouldRequest = function shouldRequest() {
    var now = this.timers.now();

    this.checkPeriod(now);

    // if .checkPeriod transitioned us back to healthy, we're done
    if (this.circuit.state !== this) {
        return this.circuit.state.shouldRequest();
    }

    // Allow one trial per period
    return !this.triedThisPeriod;
};

UnhealthyState.prototype.onRequest = function onRequest(/* req */) {
    this.triedThisPeriod = true;
    if (!this.checkPeriod(this.timers.now())) {
        this.invalidate();
    }
};

UnhealthyState.prototype.onRequestHealthy = function onRequestHealthy() {
    ++this.healthyCount;
    if (this.healthyCount > this.minResponseCount) {
        this.circuit.setState(HealthyState);
    } else {
        this.invalidate();
        this.checkPeriod(this.timers.now());
    }
};

UnhealthyState.prototype.onRequestUnhealthy = function onRequestUnhealthy() {
    this.healthyCount = 0;
    this.checkPeriod(this.timers.now());
};

UnhealthyState.prototype.onRequestError = function onRequestError(err) {
    var codeString = errors.classify(err);
    if (!errors.isUnhealthy(codeString)) {
        this.onRequestHealthy();
        return;
    }

    this.healthyCount = 0;
};

function ShortedState(options) {
    UnhealthyState.call(this, options);
}

inherits(ShortedState, UnhealthyState);

ShortedState.prototype.type = 'tchannel.shorted';
ShortedState.prototype.name = 'shorted';

ShortedState.prototype.toString = function shortedHealthyToString() {
    return '[Shorted state (unhealthy but passing traffic)]';
};

ShortedState.prototype.shouldRequest = function shouldRequest() {
    var now = this.timers.now();

    this.checkPeriod(now);

    if (this.circuit.state !== this) {
        return this.circuit.state.shouldRequest();
    }

    // TODO: do we want a separate stat for shorted requests?

    // pass all traffic regardless
    return true;
};

function parseShorts(shorts) {
    var byCaller = {};
    var keys = Object.keys(shorts);
    for (var i = 0; i < keys.length; ++i) {
        var key = keys[i];
        var match = /^([^~]+)~([^~]+)~(.+)$/.exec(key);
        if (!match) {
            continue;
        }
        var callerName = match[1];
        var serviceName = match[2];
        var endpointName = match[3];
        var byService = byCaller[callerName];
        if (!byService) {
            byService = byCaller[callerName] = {};
        }
        var byEndpoint = byService[serviceName];
        if (!byEndpoint) {
            byEndpoint = byService[serviceName] = {};
        }
        byEndpoint[endpointName] = shorts[key];
    }
    return byCaller;
}
