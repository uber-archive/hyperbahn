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

// Each circuit uses the circuits collection as the "nextHandler" for
// "shouldRequest" to consult.  Peers use this hook to weight peers both by
// healthy and other factors, but the circuit only needs to know about health
// before forwarding.

function AlwaysShouldRequestHandler() { }

AlwaysShouldRequestHandler.prototype.shouldRequest = function shouldRequest() {
    return true;
};

var alwaysShouldRequestHandler = new AlwaysShouldRequestHandler();

//  circuit = circuits                        : Circuits
//      .circuitsByServiceName[serviceName]   : ServiceCircuits
//      .circuitsByCallerName[callerName]     : EndpointCircuits
//      .circuitsByEndpointName[endpointName]

function EndpointCircuits(root) {
    var self = this;
    self.root = root;
    self.circuitsByEndpointName = {};
}

EndpointCircuits.prototype.getCircuit = function getCircuit(callerName, serviceName, endpointName) {
    var self = this;
    var circuit = self.circuitsByEndpointName['$' + endpointName];
    if (!circuit) {
        circuit = new Circuit(self.root, callerName, serviceName, endpointName);
        circuit.setState(HealthyState);
        self.circuitsByEndpointName['$' + endpointName] = circuit;
    }
    return circuit;
};

EndpointCircuits.prototype.collectCircuitTuples = function collectCircuitTuples(tuples) {
    var self = this;
    var endpointNames = Object.keys(self.circuitsByEndpointName);
    for (var index = 0; index < endpointNames.length; index++) {
        var endpointName = endpointNames[index];
        var circuit = self.circuitsByEndpointName[endpointName];
        tuples.push([circuit.callerName, circuit.serviceName, circuit.endpointName]);
    }
};

function ServiceCircuits(root) {
    var self = this;
    self.root = root;
    self.circuitsByCallerName = {};
}

ServiceCircuits.prototype.getCircuit = function getCircuit(callerName, serviceName, endpointName) {
    var self = this;
    var circuits = self.circuitsByCallerName['$' + callerName];
    if (!circuits) {
        circuits = new EndpointCircuits(self.root);
        self.circuitsByCallerName['$' + callerName] = circuits;
    }
    return circuits.getCircuit(callerName, serviceName, endpointName);
};

ServiceCircuits.prototype.collectCircuitTuples = function collectCircuitTuples(tuples) {
    var self = this;
    var callerNames = Object.keys(self.circuitsByCallerName);
    for (var index = 0; index < callerNames.length; index++) {
        var callerName = callerNames[index];
        var circuit = self.circuitsByCallerName[callerName];
        circuit.collectCircuitTuples(tuples);
    }
};

function Circuits(options) {
    var self = this;
    EventEmitter.call(self);
    self.circuitStateChangeEvent = self.defineEvent('circuitStateChange');
    self.circuitsByServiceName = {};
    self.config = options.config || {};

    self.stateOptions = new StateOptions(null, {
        timeHeap: options.timeHeap,
        timers: options.timers,
        random: options.random,
        nextHandler: alwaysShouldRequestHandler,
        period: self.config.period,
        maxErrorRate: self.config.maxErrorRate,
        minRequests: self.config.minRequests,
        probation: self.config.probation
    });
    self.egressNodes = options.egressNodes;
}

inherits(Circuits, EventEmitter);

Circuits.prototype.getCircuit = function getCircuit(callerName, serviceName, endpointName) {
    var self = this;
    var circuits = self.circuitsByServiceName['$' + serviceName];
    if (!circuits) {
        circuits = new ServiceCircuits(self);
        self.circuitsByServiceName['$' + serviceName] = circuits;
    }
    return circuits.getCircuit(callerName, serviceName, endpointName);
};

Circuits.prototype.getCircuitTuples = function getCircuitTuples() {
    var self = this;
    var tuples = [];
    var serviceNames = Object.keys(self.circuitsByServiceName);
    for (var index = 0; index < serviceNames.length; index++) {
        var serviceName = serviceNames[index];
        self.circuitsByServiceName[serviceName].collectCircuitTuples(tuples);
    }
    return tuples;
};

Circuits.prototype.getCircuitForRequest = function getCircuitForRequest(req) {
    var self = this;

    // Default the caller name.
    // All callers that fail to specifiy a cn share a circuit for each sn:en
    // and fail together.
    var callerName = req.headers.cn || 'no-cn';
    var serviceName = req.serviceName;
    if (!serviceName) {
        return new Result(new ErrorFrame('BadRequest', 'All requests must have a service name'));
    }

    var arg1 = String(req.arg1);
    var circuit = self.getCircuit(callerName, serviceName, arg1);

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
    var self = this;
    var serviceNames = Object.keys(self.circuitsByServiceName);
    for (var index = 0; index < serviceNames.length; index++) {
        var serviceName = serviceNames[index];
        if (!self.egressNodes.isExitFor(serviceName)) {
            delete self.circuitsByServiceName[serviceName];
        }
    }
};

function Circuit(root, callerName, serviceName, endpointName) {
    var self = this;
    EventEmitter.call(self);

    self.root = root;
    self.state = null;
    self.stateOptions = new StateOptions(self, self.root.stateOptions);

    self.callerName = callerName || 'no-cn';
    self.serviceName = serviceName;
    self.endpointName = endpointName;
    self.byCallerStatSuffix =
        '.by-caller.' +
        clean(self.callerName) + '.' +
        clean(self.serviceName) + '.' +
        clean(self.endpointName);
    self.byServiceStatSuffix =
        '.by-service.' +
        clean(self.callerName) + '.' +
        clean(self.serviceName) + '.' +
        clean(self.endpointName);
}

inherits(Circuit, EventEmitter);

Circuit.prototype.setState = function setState(StateType) {
    var self = this;

    var currentType = self.state && self.state.type;
    if (currentType &&
        StateType.prototype.type &&
        StateType.prototype.type === currentType) {
        return null;
    }

    assert(self.stateOptions, 'state machine must have stateOptions');
    var state = new StateType(self.stateOptions);
    if (state && state.type === currentType) {
        return null;
    }

    var oldState = self.state;
    self.state = state;
    if (oldState) {
        oldState.onDeactivate();
    }
    self.root.circuitStateChangeEvent.emit(self.root, new StateChange(self, oldState, state));
    return state;
};

Circuit.prototype.extendLogInfo = function extendLogInfo(info) {
    var self = this;
    info.callerName = self.callerName;
    info.serviceName = self.serviceName;
    info.endpointName = self.endpointName;
    return info;
};

Circuit.prototype.observeTransition =
function observeTransition(logger, statsd, eventName, logInfo) {
    var self = this;
    statsd.increment('circuits.' + eventName + '.total', 1);
    statsd.increment('circuits.' + eventName + self.byCallerStatSuffix, 1);
    statsd.increment('circuits.' + eventName + self.byServiceStatSuffix, 1);
    logger.info('circuit event: ' + eventName, self.extendLogInfo(logInfo));
};

module.exports = Circuits;

function StateOptions(circuit, options) {
    options = options || {};
    // for setState changes
    this.circuit = circuit;
    // for downstream shouldRequest, used differently in Peer and Circuit.
    this.nextHandler = options.nextHandler;
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

/*
 * Collectively, the health states receive additional options through the peer
 * options:
 * - maxErrorRate (error rate to go from healthy to unhealthy)
 * - minResponseCount (response count to go from unhealthy to healthy)
 * - TODO
 *
 * They also inherit:
 * - channel.timers
 * - channel.random
 */

function State(options) {
    var self = this;

    self.circuit = options.circuit;
    self.nextHandler = options.nextHandler;
    self.timers = options.timers;
    self.timeHeap = options.timeHeap;
    self.random = options.random;
}

State.prototype.onDeactivate = function onDeactivate() {
};

State.prototype.onRequest = function onRequest(/* req */) {
};

State.prototype.onRequestHealthy = function onRequestHealthy() {
};

State.prototype.onRequestUnhealthy = function onRequestUnhealthy() {
};

State.prototype.onRequestError = function onRequestError() {
};

State.prototype.close = function close(callback) {
    callback(null);
};

State.prototype.invalidate = function invalidate() {
    var self = this;

    if (self.circuit.invalidateScore) {
        self.circuit.invalidateScore();
    }
};

State.prototype.shouldRequest = function shouldRequest() {
    var self = this;

    var now = self.timers.now();
    if (self.willCallNextHandler(now)) {
        return self.nextHandler.shouldRequest();
    } else if (self.circuit.state !== self) {
        return self.circuit.state.shouldRequest();
    } else {
        return 0;
    }
};

function PeriodicState(options) {
    var self = this;
    State.call(self, options);

    self.period = options.period || 1000; // ms
    self.start = 0;
    self.timeout = 0;
    self.periodTimer = null;

    self.startNewPeriod(self.timers.now());
}
inherits(PeriodicState, State);

PeriodicState.prototype.startNewPeriod = function startNewPeriod(now) {
    var self = this;

    self.start = now;
    if (self.onNewPeriod()) {
        self.setPeriodTimer(self.period, now);
    }
};

PeriodicState.prototype.onDeactivate = function onDeactivate() {
    var self = this;

    if (self.periodTimer) {
        self.periodTimer.cancel();
        self.periodTimer = null;
    }
};

PeriodicState.prototype.setPeriodTimer = function setPeriodTimer(timeout, now) {
    var self = this;

    if (self.periodTimer) {
        self.periodTimer.cancel();
        self.periodTimer = null;
    }

    self.timeout = timeout;
    self.periodTimer = self.timeHeap.update(self, now);
};

PeriodicState.prototype.onTimeout = function onTimeout() {
    var self = this;

    var now = self.timers.now();
    self.checkPeriod(true, now);
};

PeriodicState.prototype.checkPeriod = function checkPeriod(inTimeout, now) {
    var self = this;

    var elapsed = now - self.start;
    var remain = self.period - elapsed;
    if (remain <= 0) {
        self.startNewPeriod(now);
        return true;
    } else if (inTimeout) {
        self.setPeriodTimer(remain, now);
    }
    return false;
};

PeriodicState.prototype.willCallNextHandler = function willCallNextHandler(now) {
    var self = this;

    self.checkPeriod(false, now);
};

function HealthyState(options) {
    var self = this;
    PeriodicState.call(self, options);

    self.maxErrorRate = options.maxErrorRate || 0.5;
    self.healthyCount = 0;
    self.unhealthyCount = 0;
    self.totalRequests = 0;
    self.minRequests = typeof options.minRequests === 'number' ?
        options.minRequests : 5;
}

inherits(HealthyState, PeriodicState);

HealthyState.prototype.type = 'tchannel.healthy';
HealthyState.prototype.healthy = true;

HealthyState.prototype.toString = function healthyToString() {
    var self = this;
    return format('[Healthy %s healthy %s unhealthy]', self.healthyCount, self.unhealthyCount);
};

HealthyState.prototype.willCallNextHandler = function willCallNextHandler(now) {
    var self = this;

    self.checkPeriod(false, now);

    // active unless .onNewPeriod transitioned
    return self.circuit.state === self;
};

HealthyState.prototype.onNewPeriod = function onNewPeriod(now) {
    var self = this;

    var totalCount = self.healthyCount + self.unhealthyCount;

    // TODO: could store on self for introspection, maybe call it
    // "lastPeriodErrorRate"?; we could even keep a fixed size sample of error
    // rates from periods and choose based on their differences (discrete
    // derivative)...
    var errorRate = self.unhealthyCount / totalCount;

    if (errorRate > self.maxErrorRate &&
        self.totalRequests > self.minRequests) {
        // Transition to unhealthy state if the healthy request rate dips below
        // the acceptable threshold.
        self.circuit.setState(UnhealthyState);
        // TODO: useful to mark self dead somehow? for now we're just using "am
        // I still the current state" logic coupled to the consuming
        // circuit in .willCallNextHandler
    } else {
        // okay last period, reset counts for the new period
        self.healthyCount = 0;
        self.unhealthyCount = 0;
    }

    return false;
};

HealthyState.prototype.onRequest = function onRequest(/* req */) {
    var self = this;

    self.invalidate();
};

HealthyState.prototype.onRequestHealthy = function onRequestHealthy() {
    var self = this;
    self.healthyCount++;
    self.totalRequests++;
    if (!self.checkPeriod(false, self.timers.now())) {
        self.invalidate();
    }
};

HealthyState.prototype.onRequestUnhealthy = function onRequestUnhealthy() {
    var self = this;
    self.totalRequests++;
    self.unhealthyCount++;
    if (!self.checkPeriod(false, self.timers.now())) {
        self.invalidate();
    }
};

HealthyState.prototype.onRequestError = function onRequestError(err) {
    var self = this;

    self.totalRequests++;
    var codeString = errors.classify(err);
    if (errors.isUnhealthy(codeString)) {
        self.unhealthyCount++;
    } else {
        self.healthyCount++;
    }
    if (!self.checkPeriod(false, self.timers.now())) {
        self.invalidate();
    }
};

function UnhealthyState(options) {
    var self = this;
    PeriodicState.call(self, options);

    self.minResponseCount = options.probation || 5;
    self.healthyCount = 0;
    self.triedThisPeriod = true;
}

inherits(UnhealthyState, PeriodicState);

UnhealthyState.prototype.type = 'tchannel.unhealthy';
UnhealthyState.prototype.healthy = false;

UnhealthyState.prototype.onNewPeriod = function onNewPeriod(now) {
    var self = this;

    if (self.healthyCount >= self.minResponseCount) {
        self.circuit.setState(HealthyState);
        return false;
    }

    var triedLastPeriod = self.triedThisPeriod;
    self.triedThisPeriod = false;

    if (triedLastPeriod) {
        // score only changes if we had gone back to "closed" state, otherwise
        // we simply are remaining "open" for a single probe
        self.invalidate();
    }

    return false;
};

UnhealthyState.prototype.toString = function healthyToString() {
    var self = this;
    return format('[Unhealthy %s consecutive healthy requests]', self.healthyCount);
};

UnhealthyState.prototype.willCallNextHandler = function willCallNextHandler(now) {
    var self = this;

    self.checkPeriod(false, now);

    // if .checkPeriod transitioned us back to healthy, we're done
    if (self.circuit.state !== self) {
        return false;
    }

    // Allow one trial per period
    return !self.triedThisPeriod;
};

UnhealthyState.prototype.onRequest = function onRequest(/* req */) {
    var self = this;

    self.triedThisPeriod = true;
    if (!self.checkPeriod(false, self.timers.now())) {
        self.invalidate();
    }
};

UnhealthyState.prototype.onRequestHealthy = function onRequestHealthy() {
    var self = this;

    self.healthyCount++;
    if (self.healthyCount > self.minResponseCount) {
        self.circuit.setState(HealthyState);
    } else {
        self.invalidate();
        self.checkPeriod(false, self.timers.now());
    }
};

UnhealthyState.prototype.onRequestUnhealthy = function onRequestUnhealthy() {
    var self = this;

    self.healthyCount = 0;
    self.checkPeriod(false, self.timers.now());
};

UnhealthyState.prototype.onRequestError = function onRequestError(err) {
    var self = this;

    var codeString = errors.classify(err);
    if (!errors.isUnhealthy(codeString)) {
        self.onRequestHealthy();
        return;
    }

    self.healthyCount = 0;
};
