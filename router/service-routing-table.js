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

var RelayHandler = require('tchannel/relay_handler');

var DEFAULT_LOG_GRACE_PERIOD = 5 * 60 * 1000;

module.exports = ServiceRoutingTable;

function ServiceRoutingTable(options) {
    if (!(this instanceof ServiceRoutingTable)) {
        return new ServiceRoutingTable(options);
    }

    var self = this;

    assert(options.logger, 'logger required');
    self.logger = options.logger;

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
}

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
        serviceChannel.handler.circuit = self.circuits;
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

