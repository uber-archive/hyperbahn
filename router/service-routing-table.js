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
var clean = require('tchannel/lib/statsd').clean;
var RelayHandler = require('tchannel/relay_handler');

var Circuits = require('../circuits.js');

var DEFAULT_LOG_GRACE_PERIOD = 5 * 60 * 1000;

module.exports = ServiceRoutingTable;

function ServiceRoutingTable(options) {
    if (!(this instanceof ServiceRoutingTable)) {
        return new ServiceRoutingTable(options);
    }

    var self = this;

    assert(options.logger, 'logger required');
    self.logger = options.logger;

    assert(options.statsd, 'statsd required');
    self.statsd = options.statsd;

    assert(options.channel, 'channel required');
    self.channel = options.channel;

    assert(options.discoveryBridge, 'discoveryBridge required');
    self.discoveryBridge = options.discoveryBridge;

    self.logGracePeriod = options.logGracePeriod ||
        DEFAULT_LOG_GRACE_PERIOD;
    self.createdAt = Date.now();

    // Populated by remote-config
    self.peerHeapEnabledServices = Object.create(null);
    self.peerHeapEnabledGlobal = false;

    // TODO: port over circuits itself
    self.circuitsEnabled = false;
    assert(options.circuitsConfig, 'circuitsConfig required');
    self.circuitsConfig = options.circuitsConfig;
    self.circuits = null;
    self.boundOnCircuitStateChange = onCircuitStateChange;

    if (self.circuitsConfig && self.circuitsConfig.enabled) {
        self.enableCircuits();
    }

    function onCircuitStateChange(stateChange) {
        self.onCircuitStateChange(stateChange);
    }
}

ServiceRoutingTable.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    self.channel.extendLogInfo(info);

    info.circuitsEnabled = self.circuitsEnabled;

    return info;
};

ServiceRoutingTable.prototype.enableCircuits =
function enableCircuits() {
    var self = this;

    if (self.circuitsEnabled) {
        return;
    }
    self.circuitsEnabled = true;

    if (!self.circuits) {
        self.initCircuits();
    }

    var serviceNames = Object.keys(self.channel.subChannels);
    for (var index = 0; index < serviceNames.length; index++) {
        var serviceName = serviceNames[index];
        var subChannel = self.channel.subChannels[serviceName];
        if (subChannel.handler.type === 'tchannel.relay-handler' &&
            subChannel.serviceProxyMode === 'exit'
        ) {
            subChannel.handler.circuits = self.circuits;
        }
    }
};

ServiceRoutingTable.prototype.initCircuits =
function initCircuits() {
    var self = this;

    self.circuits = new Circuits({
        timeHeap: self.channel.timeHeap,
        timers: self.channel.timers,
        random: self.random,
        config: self.circuitsConfig
    });

    self.circuits.circuitStateChangeEvent.on(self.boundOnCircuitStateChange);
};

ServiceRoutingTable.prototype.disableCircuits =
function disableCircuits() {
    var self = this;

    if (!self.circuitsEnabled) {
        return;
    }
    self.circuitsEnabled = false;

    var serviceNames = Object.keys(self.channel.subChannels);
    for (var index = 0; index < serviceNames.length; index++) {
        var serviceName = serviceNames[index];
        var subChannel = self.channel.subChannels[serviceName];
        if (subChannel.handler.type === 'tchannel.relay-handler' &&
            subChannel.serviceProxyMode === 'exit'
        ) {
            subChannel.handler.circuits = null;
        }
    }
};

ServiceRoutingTable.prototype.onCircuitStateChange =
function onCircuitStateChange(change) {
    var self = this;

    var circuit = change.circuit;
    var oldState = change.oldState;
    var state = change.state;

    if (oldState && oldState.healthy !== state.healthy) {
        // unhealthy -> healthy
        if (state.healthy) {
            self.statsd.increment('circuits.healthy.total', 1);
            self.statsd.increment(
                'circuits.healthy.by-caller.' +
                    clean(circuit.callerName) + '.' +
                    clean(circuit.serviceName) + '.' +
                    clean(circuit.endpointName),
                1
            );
            self.statsd.increment(
                'circuits.healthy.by-service.' +
                    clean(circuit.serviceName) + '.' +
                    clean(circuit.callerName) + '.' +
                    clean(circuit.endpointName),
                1
            );
            self.logger.info(
                'circuit returned to good health',
                self.extendLogInfo(circuit.extendLogInfo({}))
            );
        // healthy -> unhealthy
        } else {
            self.statsd.increment('circuits.unhealthy.total', 1);
            self.statsd.increment(
                'circuits.unhealthy.by-caller.' +
                    clean(circuit.callerName) + '.' +
                    clean(circuit.serviceName) + '.' +
                    clean(circuit.endpointName),
                1
            );
            self.statsd.increment(
                'circuits.unhealthy.by-service.' +
                    clean(circuit.serviceName) + '.' +
                    clean(circuit.callerName) + '.' +
                    clean(circuit.endpointName),
                1
            );
            self.logger.info(
                'circuit became unhealthy',
                self.extendLogInfo(circuit.extendLogInfo({}))
            );
        }
    }
};

ServiceRoutingTable.prototype.createServiceChannel =
function createServiceChannel(serviceName) {
    var self = this;

    var now = Date.now();
    if (now >= self.createdAt + self.logGracePeriod) {
        self.logger.info(
            'Creating new sub channel',
            self.extendLogInfo({
                serviceName: serviceName
            })
        );
    }

    var choosePeerWithHeap = self.peerHeapEnabledGlobal;
    if (serviceName in self.peerHeapEnabledServices) {
        choosePeerWithHeap = self.peerHeapEnabledServices[serviceName];
    }

    var options = {
        serviceName: serviceName,
        choosePeerWithHeap: choosePeerWithHeap
    };

    var serviceChannel = self.channel.makeSubChannel(options);
    serviceChannel.handler = new RelayHandler(serviceChannel);

    self.discoveryBridge.notifyNewRoutingService(serviceName);

    return serviceChannel;
};

ServiceRoutingTable.prototype.getOrCreateServiceChannel =
function getOrCreateServiceChannel(serviceName) {
    var self = this;

    var channel = self.channel.subChannels[serviceName];
    if (channel) {
        return channel;
    }

    return self.createServiceChannel(serviceName);
};

ServiceRoutingTable.prototype.updateRoutingTable =
function updateRoutingTable(serviceName, mode, initialPeers) {
    var self = this;

    var serviceChannel = self.getOrCreateServiceChannel(serviceName);
    serviceChannel.serviceProxyMode = mode; // duck: punched

    if (mode === 'forward') {
        for (var i = 0; i < initialPeers.length; i++) {
            self.getServicePeer(serviceChannel, initialPeers[i]);
        }
    }

    if (mode === 'exit' && self.circuitsEnabled) {
        serviceChannel.handler.circuits = self.circuits;
    }

    var preferConnectionDirection = mode === 'exit' ? 'out' : 'any';
    serviceChannel.peers.preferConnectionDirection = preferConnectionDirection;
    var peers = serviceChannel.peers.values();
    for (var j = 0; j < peers.length; j++) {
        peers[j].setPreferConnectionDirection(preferConnectionDirection);
    }
};

ServiceRoutingTable.prototype.getServicePeer =
function getServicePeer(serviceChannel, hostPort) {
    var peer = serviceChannel.peers.get(hostPort);
    if (!peer) {
        peer = serviceChannel.peers.add(hostPort);
    }
    if (!peer.serviceProxyServices) {
        peer.serviceProxyServices = {};
    }
    peer.serviceProxyServices[serviceChannel.serviceName] = true;
    return peer;
};

ServiceRoutingTable.prototype.setPeerHeapEnabled =
function setPeerHeapEnabled(peerHeapEnabledServices, peerHeapEnabledGlobal) {
    var self = this;

    assert(typeof peerHeapEnabledServices === 'object');
    self.peerHeapEnabledServices = peerHeapEnabledServices;
    self.peerHeapEnabledGlobal = peerHeapEnabledGlobal;

    var keys = Object.keys(self.channel.subChannels);
    var i;
    for (i = 0; i < keys.length; i++) {
        var serviceName = keys[i];
        var enabled = self.peerHeapEnabledGlobal;
        if (serviceName in self.peerHeapEnabledServices) {
            enabled = self.peerHeapEnabledServices[serviceName];
        }
        self.channel.subChannels[serviceName].setChoosePeerWithHeap(enabled);
    }
};

ServiceRoutingTable.prototype.isExitFor =
function isExitFor(serviceName) {
    var self = this;

    var serviceChannel = self.channel.subChannels[serviceName];
    if (!serviceChannel) {
        return false;
    }

    return serviceChannel.serviceProxyMode === 'exit';
};

ServiceRoutingTable.prototype.closeChannel =
function closeChannel(serviceName) {
    var self = this;

    var serviceChannel = self.channel.subChannels[serviceName];
    if (serviceChannel) {
        serviceChannel.close();
        delete self.channel.subChannels[serviceName];
        // TODO: wat even self.rateLimiter...
        // self.rateLimiter.removeServiceCounter(serviceName);
        // self.rateLimiter.removeKillSwitchCounter(serviceName);
    }
};

ServiceRoutingTable.prototype.forgetServicePeer =
function forgetServicePeer(serviceName, hostPort) {
    var self = this;

    var serviceChannel = self.channel.subChannels[serviceName];
    if (serviceChannel) {
        serviceChannel.peers.delete(hostPort);
    }
};

