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

var Result = require('bufrw/result');
var assert = require('assert');
var format = require('util').format;
var inherits = require('util').inherits;

var EventEmitter = require('tchannel/lib/event_emitter');
var clean = require('tchannel/lib/statsd').clean;
var errors = require('tchannel/errors');

function StateChange(target, oldState, state) {
    this.target = target;
    this.oldState = oldState;
    this.state = state;
}

//  circuit = circuits                        : Circuits
//      .circuitsByServiceName[serviceName]   : ServiceCircuits
//      .circuitsByCallerName[callerName]     : EndpointCircuits
//      .circuitsByEndpointName[endpointName]

function EndpointCircuits(root) {
    this.root = root;
    this.circuitsByEndpointName = {};
}

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
    EventEmitter.call(this);
    this.circuitStateChangeEvent = this.defineEvent('circuitStateChange');
    this.circuitsByServiceName = {};
    this.config = options.config || {};

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

inherits(Circuits, EventEmitter);

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

Circuits.prototype.getCircuitForRequest = function getCircuitForRequest(req) {
    // Default the caller name.
    // All callers that fail to specifiy a cn share a circuit for each sn:en
    // and fail together.
    var callerName = req.headers.cn || 'no-cn';
    var serviceName = req.serviceName;
    if (!serviceName) {
        return new Result(new ErrorFrame('BadRequest', 'All requests must have a service name'));
    }

    var arg1 = String(req.arg1);
    var circuit = this.getCircuit(callerName, serviceName, arg1);

    if (!circuit.state.shouldRequest()) {
        return new Result(new ErrorFrame('Declined', 'Service is not healthy'));
    }

    return new Result(null, circuit);
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
    EventEmitter.call(this);

    this.root = root;
    this.state = null;
    this.stateOptions = new StateOptions(this, this.root.stateOptions);

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
}

inherits(Circuit, EventEmitter);

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
    this.root.circuitStateChangeEvent.emit(this.root, new StateChange(this, oldState, state));
    return state;
};

Circuit.prototype.extendLogInfo = function extendLogInfo(info) {
    info.callerName = this.callerName;
    info.serviceName = this.serviceName;
    info.endpointName = this.endpointName;
    return info;
};

Circuit.prototype.observeTransition =
function observeTransition(logger, statsd, eventName, logInfo) {
    statsd.increment('circuits.' + eventName + '.total', 1);
    statsd.increment('circuits.' + eventName + this.byCallerStatSuffix, 1);
    statsd.increment('circuits.' + eventName + this.byServiceStatSuffix, 1);
    logger.info('circuit event: ' + eventName, this.extendLogInfo(logInfo));
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
        this.circuit.setState(UnhealthyState);
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
