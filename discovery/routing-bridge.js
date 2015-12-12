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

var timers = require('timers');

module.exports = RoutingBridge;

function RoutingBridge(routingWorker) {
    if (!(this instanceof RoutingBridge)) {
        return new RoutingBridge(routingWorker);
    }

    var self = this;

    self._routingWorker = routingWorker;
    self.draining = false;

    self.lazyTimeout = null;

}

RoutingBridge.prototype.listen = function listen(port, host, cb) {
    var self = this;

    self._routingWorker.tchannel.on('listening', onListening);
    self._routingWorker.tchannel.listen(port, host);

    function onListening() {
        cb(null, self._routingWorker.tchannel.hostPort);
    }
};

RoutingBridge.prototype.extendLogInfo = function extendLogInfo(info) {
    var self = this;

    return self._routingWorker.tchannel.extendLogInfo(info);
};

RoutingBridge.prototype.destroy = function destroy() {
    var self = this;

    timers.clearTimeout(self.lazyTimeout);
    self._routingWorker.destroy();
};

RoutingBridge.prototype.isDraining = function isDraining() {
    var self = this;

    return self._routingWorker.tchannel.draining;
};

RoutingBridge.prototype.drain = function drain(message, cb) {
    var self = this;

    return self._routingWorker.tchannel.drain(message, cb);
};

RoutingBridge.prototype.setMaximumRelayTTL =
function setMaximumRelayTTL(maximumRelayTTL) {
    var self = this;

    self._routingWorker.tchannel.setMaximumRelayTTL(maximumRelayTTL);
};

RoutingBridge.prototype.setMaxTombstoneTTL =
function setMaxTombstoneTTL(ttl) {
    var self = this;

    self._routingWorker.tchannel.setMaxTombstoneTTL(ttl);
};

RoutingBridge.prototype.setLazyHandling =
function setLazyHandling(enabled) {
    var self = this;

    self._routingWorker.tchannel.setLazyRelaying(enabled);

    timers.clearTimeout(self.lazyTimeout);

    if (enabled === false) {
        timers.clearTimeout(self.lazyTimeout);
        self.lazyTimeout = timers.setTimeout(turnOffLazyHandling, 30000);
    } else {
        self._routingWorker.tchannel.setLazyHandling(enabled);
    }

    function turnOffLazyHandling() {
        self._routingWorker.tchannel.setLazyHandling(enabled);
    }
};

RoutingBridge.prototype.unsafeGetPeer =
function unsafeGetPeer(hostPort) {
    var self = this;

    return self._routingWorker.tchannel.peers.get(hostPort);
};

RoutingBridge.prototype.unsafeGetRateLimiter =
function unsafeGetRateLimiter() {
    var self = this;

    return self._routingWorker.serviceProxyHandler.rateLimiter;
};

RoutingBridge.prototype.setPeerHeapEnabled =
function setPeerHeapEnabled(peerHeapConfig, peerHeapGlobalConfig) {
    var self = this;

    return self._routingWorker.serviceRoutingTable.setPeerHeapEnabled(
        peerHeapConfig, peerHeapGlobalConfig
    );
};

RoutingBridge.prototype.updateKillSwitches =
function updateKillSwitches(killSwitches) {
    var self = this;

    var blockingTable = self._routingWorker.serviceProxyHandler.blockingTable;

    blockingTable.unblockAllRemoteConfig();

    for (var i = 0; i < killSwitches.length; i++) {
        var value = killSwitches[i];
        var edge = value.split('~~');
        if (edge.length === 2 && value !== '*~~*') {
            blockingTable.blockRemoteConfig(edge[0], edge[1]);
        }
    }
};

RoutingBridge.prototype.getBlockingTable =
function getBlockingTable(cb) {
    var self = this;

    var blockingTable = self._routingWorker.serviceProxyHandler.blockingTable;

    cb(null, blockingTable._blockingTable);
};

RoutingBridge.prototype.blockEdge =
function blockEdge(callerName, serviceName, cb) {
    var self = this;

    var blockingTable = self._routingWorker.serviceProxyHandler.blockingTable;

    blockingTable.block(callerName, serviceName);
    cb(null);
};

RoutingBridge.prototype.unblockEdge =
function unblockEdge(callerName, serviceName, cb) {
    var self = this;

    var blockingTable = self._routingWorker.serviceProxyHandler.blockingTable;

    blockingTable.unblock(callerName, serviceName);
    cb(null);
};

RoutingBridge.prototype.toggleRateLimiter =
function toggleRateLimiter(enabled) {
    var self = this;

    var serviceProxyHandler = self._routingWorker.serviceProxyHandler;
    if (enabled) {
        serviceProxyHandler.enableRateLimiter();
    } else {
        serviceProxyHandler.disableRateLimiter();
    }
};

RoutingBridge.prototype.updateTotalRateLimit =
function updateTotalRateLimit(limit) {
    var self = this;

    var serviceProxyHandler = self._routingWorker.serviceProxyHandler;
    serviceProxyHandler.rateLimiter.updateTotalLimit(limit);
};

RoutingBridge.prototype.updateRateLimitExemptServices =
function updateRateLimitExemptServices(exemptServices) {
    var self = this;

    var serviceProxyHandler = self._routingWorker.serviceProxyHandler;
    serviceProxyHandler.rateLimiter.updateExemptServices(exemptServices);
};

RoutingBridge.prototype.updateRpsLimitForAllServices =
function updateRpsLimitForAllServices(rpsLimitForServiceName) {
    var self = this;

    var serviceProxyHandler = self._routingWorker.serviceProxyHandler;
    serviceProxyHandler.rateLimiter.updateRpsLimitForAllServices(rpsLimitForServiceName);
};

RoutingBridge.prototype.updateServiceRateLimit =
function updateServiceRateLimit(serviceName, limit) {
    var self = this;

    var serviceProxyHandler = self._routingWorker.serviceProxyHandler;
    serviceProxyHandler.rateLimiter.updateServiceLimit(serviceName, limit);
};

RoutingBridge.prototype.addRateLimitExceptService =
function addRateLimitExceptService(serviceName) {
    var self = this;

    var serviceProxyHandler = self._routingWorker.serviceProxyHandler;
    var exemptServices = serviceProxyHandler.rateLimiter.exemptServices.slice();

    if (exemptServices.indexOf(serviceName) === -1) {
        exemptServices.push(serviceName);
    }

    serviceProxyHandler.rateLimiter.updateExemptServices(exemptServices);
};

RoutingBridge.prototype.removeRateLimitExceptService =
function removeRateLimitExceptService(serviceName) {
    var self = this;

    var serviceProxyHandler = self._routingWorker.serviceProxyHandler;
    var exemptServices = serviceProxyHandler.rateLimiter.exemptServices.slice();

    if (exemptServices.indexOf(serviceName) !== -1) {
        exemptServices.splice(exemptServices.indexOf(serviceName), 1);
    }

    serviceProxyHandler.rateLimiter.updateExemptServices(exemptServices);
};

RoutingBridge.prototype.getRateLimiterInfo =
function getRateLimiterInfo(cb) {
    var self = this;

    var serviceProxyHandler = self._routingWorker.serviceProxyHandler;
    var rateLimiter = serviceProxyHandler.rateLimiter;

    cb(null, {
        enabled: serviceProxyHandler.rateLimiterEnabled,
        totalRpsLimit: rateLimiter.totalRpsLimit,
        exemptServices: rateLimiter.exemptServices,
        rpsLimitForServiceName: rateLimiter.rpsLimitForServiceName,
        totalRequestCounter: rateLimiter.totalRequestCounter,
        serviceCounters: rateLimiter.counters
    });
};

RoutingBridge.prototype.updateTotalKillSwitchBuffer =
function updateTotalKillSwitchBuffer(totalBuffer) {
    var self = this;

    var serviceProxyHandler = self._routingWorker.serviceProxyHandler;

    serviceProxyHandler.rateLimiter.updateTotalKillSwitchBuffer(totalBuffer);
};

RoutingBridge.prototype.updateRoutingTable =
function updateRoutingTable(serviceName, mode, peers) {
    var self = this;

    var serviceRoutingTable = self._routingWorker.serviceRoutingTable;

    serviceRoutingTable.updateRoutingTable(serviceName, mode, peers);
};
