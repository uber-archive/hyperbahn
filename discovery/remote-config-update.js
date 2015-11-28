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

function RemoteConfigUpdater() {

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
        self.socketInspector.enable();
    } else {
        self.socketInspector.disable();
    }
};

RemoteConfigUpdater.prototype.setMaximumRelayTTL =
function setMaximumRelayTTL() {
    var self = this;

    var maximumRelayTTL = self.remoteConfig.get(
        'relay.maximum-ttl', 2 * 60 * 1000
    );
    self.tchannel.setMaximumRelayTTL(maximumRelayTTL);
};

RemoteConfigUpdater.prototype.updateLazyHandling = function updateLazyHandling() {
    var self = this;
    var enabled = self.remoteConfig.get('lazy.handling.enabled', true);
    self.tchannel.setLazyRelaying(enabled);

    self.tchannel.timers.clearTimeout(self.lazyTimeout);

    if (enabled === false) {
        self.tchannel.timers.clearTimeout(self.lazyTimeout);
        self.lazyTimeout = self.tchannel.timers.setTimeout(turnOffLazyHandling, 30000);
    } else {
        self.tchannel.setLazyHandling(enabled);
    }

    function turnOffLazyHandling() {
        self.tchannel.setLazyHandling(enabled);
    }
};

RemoteConfigUpdater.prototype.updateReservoir = function updateReservoir() {
    var self = this;
    if (self.logReservoir) {
        var size = self.remoteConfig.get('log.reservoir.size', 100);
        var interval = self.remoteConfig.get('log.reservoir.flushInterval', 50);

        self.logReservoir.setFlushInterval(interval);
        self.logReservoir.setSize(size);
    }
};

RemoteConfigUpdater.prototype.updateCircuitsEnabled = function updateCircuitsEnabled() {
    var self = this;
    var enabled = self.remoteConfig.get('circuits.enabled', false);
    if (enabled) {
        self.serviceProxy.enableCircuits();
    } else {
        self.serviceProxy.disableCircuits();
    }
};

RemoteConfigUpdater.prototype.updateRateLimitingEnabled = function updateRateLimitingEnabled() {
    var self = this;
    var enabled = self.remoteConfig.get('rateLimiting.enabled', false);
    if (enabled) {
        self.serviceProxy.enableRateLimiter();
    } else {
        self.serviceProxy.disableRateLimiter();
    }
};

RemoteConfigUpdater.prototype.updateReapPeersPeriod =
function updateReapPeersPeriod() {
    var self = this;
    var period = self.remoteConfig.get('peerReaper.period', 0);
    self.serviceProxy.setReapPeersPeriod(period);
};

RemoteConfigUpdater.prototype.updatePrunePeersPeriod =
function updatePrunePeersPeriod() {
    var self = this;
    var period = self.remoteConfig.get('peerPruner.period', 0);
    self.serviceProxy.setPrunePeersPeriod(period);
};

RemoteConfigUpdater.prototype.updatePartialAffinityEnabled = function updatePartialAffinityEnabled() {
    var self = this;
    var enabled = self.remoteConfig.get('partialAffinity.enabled', false);
    self.serviceProxy.setPartialAffinityEnabled(enabled);
};

RemoteConfigUpdater.prototype.updateTotalRpsLimit = function updateTotalRpsLimit() {
    var self = this;
    var limit = self.remoteConfig.get('rateLimiting.totalRpsLimit', 1200);
    self.serviceProxy.rateLimiter.updateTotalLimit(limit);
};

RemoteConfigUpdater.prototype.updateExemptServices = function updateExemptServices() {
    var self = this;
    var exemptServices = self.remoteConfig.get('rateLimiting.exemptServices', ['autobahn', 'ringpop']);
    self.serviceProxy.rateLimiter.updateExemptServices(exemptServices);
};

RemoteConfigUpdater.prototype.updateRpsLimitForServiceName = function updateRpsLimitForServiceName() {
    var self = this;
    var rpsLimitForServiceName = self.remoteConfig.get('rateLimiting.rpsLimitForServiceName', {});
    self.serviceProxy.rateLimiter.updateRpsLimitForAllServices(rpsLimitForServiceName);
};

RemoteConfigUpdater.prototype.updateKValues = function updateKValues() {
    var self = this;
    var defaultKValue = self.remoteConfig.get('kValue.default', 10);
    self.egressNodes.setDefaultKValue(defaultKValue);

    var serviceKValues = self.remoteConfig.get('kValue.services', {});
    var keys = Object.keys(serviceKValues);
    for (var i = 0; i < keys.length; i++) {
        var serviceName = keys[i];
        var kValue = serviceKValues[serviceName];
        self.egressNodes.setKValueFor(serviceName, kValue);
        self.serviceProxy.updateServiceChannels();
    }
};

RemoteConfigUpdater.prototype.updateKillSwitches = function updateKillSwitches() {
    var self = this;
    self.serviceProxy.unblockAllRemoteConfig();
    var killSwitches = self.remoteConfig.get('killSwitch', []);

    for (var i = 0; i < killSwitches.length; i++) {
        var value = killSwitches[i];
        var edge = value.split('~~');
        if (edge.length === 2 && value !== '*~~*') {
            self.serviceProxy.blockRemoteConfig(edge[0], edge[1]);
        }
    }
};

RemoteConfigUpdater.prototype.updatePeerHeapEnabled = function updatePeerHeapEnabled() {
    var self = this;
    var peerHeapConfig = self.remoteConfig.get('peer-heap.enabled.services', {});
    var peerHeapGlobalConfig = self.remoteConfig.get('peer-heap.enabled.global', false);

    self.serviceProxy.setPeerHeapEnabled(peerHeapConfig, peerHeapGlobalConfig);
};
