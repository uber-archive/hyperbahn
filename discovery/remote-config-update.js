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

module.exports = RemoteConfigUpdater;

function RemoteConfigUpdater(worker) {
    if (!(this instanceof RemoteConfigUpdater)) {
        return new RemoteConfigUpdater(worker);
    }

    var self = this;

    self.remoteConfig = worker.clients.remoteConfig;
    self.clients = worker.clients;
    self.worker = worker;

    self.lazyTimeout = null;
}

RemoteConfigUpdater.prototype.onRemoteConfigUpdate = function onRemoteConfigUpdate() {
    var self = this;

    self.setSocketInspector();
    self.updateMaxTombstoneTTL();
    self.updateLazyHandling();
    self.updateCircuitsEnabled();
    self.updateRateLimitingEnabled();
    self.updateTotalRpsLimit();
    self.updateExemptServices();
    self.updateRpsLimitForServiceName();
    self.updateKValues();
    self.updateKillSwitches();
    self.updateReservoir();
    self.updateReapPeersPeriod();
    self.updatePrunePeersPeriod();
    self.updatePartialAffinityEnabled();
    self.setMaximumRelayTTL();
    self.updatePeerHeapEnabled();
};

RemoteConfigUpdater.prototype.setSocketInspector =
function setSocketInspector() {
    var self = this;

    var socketInspectorEnabled = self.remoteConfig.get(
        'clients.socket-inspector.enabled', false
    );

    if (socketInspectorEnabled) {
        self.clients.socketInspector.enable();
    } else {
        self.clients.socketInspector.disable();
    }
};

RemoteConfigUpdater.prototype.setMaximumRelayTTL =
function setMaximumRelayTTL() {
    var self = this;

    var maximumRelayTTL = self.remoteConfig.get(
        'relay.maximum-ttl', 2 * 60 * 1000
    );
    self.worker.routingBridge.setMaximumRelayTTL(maximumRelayTTL);
};

RemoteConfigUpdater.prototype.updateLazyHandling = function updateLazyHandling() {
    var self = this;
    var enabled = self.remoteConfig.get('lazy.handling.enabled', true);

    self.worker.routingBridge.setLazyHandling(enabled);
};

RemoteConfigUpdater.prototype.updateReservoir = function updateReservoir() {
    var self = this;
    if (self.clients.logReservoir) {
        var size = self.remoteConfig.get('log.reservoir.size', 100);
        var interval = self.remoteConfig.get('log.reservoir.flushInterval', 50);

        self.clients.logReservoir.setFlushInterval(interval);
        self.clients.logReservoir.setSize(size);
    }
};

RemoteConfigUpdater.prototype.updateCircuitsEnabled = function updateCircuitsEnabled() {
    var self = this;
    var enabled = self.remoteConfig.get('circuits.enabled', false);
    if (enabled) {
        self.worker.serviceProxy.enableCircuits();
    } else {
        self.worker.serviceProxy.disableCircuits();
    }
};

RemoteConfigUpdater.prototype.updateRateLimitingEnabled = function updateRateLimitingEnabled() {
    var self = this;
    var enabled = self.remoteConfig.get('rateLimiting.enabled', false);
    if (enabled) {
        self.worker.serviceProxy.enableRateLimiter();
    } else {
        self.worker.serviceProxy.disableRateLimiter();
    }
};

RemoteConfigUpdater.prototype.updateReapPeersPeriod =
function updateReapPeersPeriod() {
    var self = this;
    var period = self.remoteConfig.get('peerReaper.period', 0);
    self.worker.serviceProxy.setReapPeersPeriod(period);
};

RemoteConfigUpdater.prototype.updatePrunePeersPeriod =
function updatePrunePeersPeriod() {
    var self = this;
    var period = self.remoteConfig.get('peerPruner.period', 0);
    self.worker.serviceProxy.setPrunePeersPeriod(period);
};

RemoteConfigUpdater.prototype.updatePartialAffinityEnabled = function updatePartialAffinityEnabled() {
    var self = this;
    var enabled = self.remoteConfig.get('partialAffinity.enabled', false);
    self.worker.serviceProxy.setPartialAffinityEnabled(enabled);
};

RemoteConfigUpdater.prototype.updateTotalRpsLimit = function updateTotalRpsLimit() {
    var self = this;
    var limit = self.remoteConfig.get('rateLimiting.totalRpsLimit', 1200);
    self.worker.serviceProxy.rateLimiter.updateTotalLimit(limit);
};

RemoteConfigUpdater.prototype.updateExemptServices = function updateExemptServices() {
    var self = this;
    var exemptServices = self.remoteConfig.get('rateLimiting.exemptServices', ['autobahn', 'ringpop']);
    self.worker.serviceProxy.rateLimiter.updateExemptServices(exemptServices);
};

RemoteConfigUpdater.prototype.updateRpsLimitForServiceName = function updateRpsLimitForServiceName() {
    var self = this;
    var rpsLimitForServiceName = self.remoteConfig.get('rateLimiting.rpsLimitForServiceName', {});
    self.worker.serviceProxy.rateLimiter.updateRpsLimitForAllServices(rpsLimitForServiceName);
};

RemoteConfigUpdater.prototype.updateKValues = function updateKValues() {
    var self = this;
    var defaultKValue = self.remoteConfig.get('kValue.default', 10);
    self.clients.egressNodes.setDefaultKValue(defaultKValue);

    var serviceKValues = self.remoteConfig.get('kValue.services', {});
    var keys = Object.keys(serviceKValues);
    for (var i = 0; i < keys.length; i++) {
        var serviceName = keys[i];
        var kValue = serviceKValues[serviceName];
        self.clients.egressNodes.setKValueFor(serviceName, kValue);
        self.worker.serviceProxy.updateServiceChannels();
    }
};

RemoteConfigUpdater.prototype.updateKillSwitches = function updateKillSwitches() {
    var self = this;
    self.worker.serviceProxy.unblockAllRemoteConfig();
    var killSwitches = self.remoteConfig.get('killSwitch', []);

    for (var i = 0; i < killSwitches.length; i++) {
        var value = killSwitches[i];
        var edge = value.split('~~');
        if (edge.length === 2 && value !== '*~~*') {
            self.worker.serviceProxy.blockRemoteConfig(edge[0], edge[1]);
        }
    }
};

RemoteConfigUpdater.prototype.updatePeerHeapEnabled = function updatePeerHeapEnabled() {
    var self = this;
    var peerHeapConfig = self.remoteConfig.get('peer-heap.enabled.services', {});
    var peerHeapGlobalConfig = self.remoteConfig.get('peer-heap.enabled.global', false);

    self.worker.serviceProxy.setPeerHeapEnabled(peerHeapConfig, peerHeapGlobalConfig);
};

RemoteConfigUpdater.prototype.updateMaxTombstoneTTL =
function updateMaxTombstoneTTL() {
    var self = this;

    var ttl = self.remoteConfig.get('tchannel.max-tombstone-ttl', 5000);

    self.worker.routingBridge.setMaxTombstoneTTL(ttl);
};
