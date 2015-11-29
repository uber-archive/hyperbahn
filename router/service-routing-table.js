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
var timers = require('timers');

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

    self.logGracePeriod = options.logGracePeriod ||
        DEFAULT_LOG_GRACE_PERIOD;
    self.createdAt = Date.now();

    // Populated by remote-config
    self.peerHeapEnabledServices = Object.create(null);
    self.peerHeapEnabledGlobal = false;

    // TODO: port over circuits itself
    self.circuitsEnabled = false;

    // TODO: wtf egressNodes
    self.egressNodes = null;
}

ServiceRoutingTable.prototype.createServiceChannel =
function createServiceChannel(serviceName) {
    var self = this;

    var now = timers.now();
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

    // TODO: this belongs in discovery...
    self.transitionChannelToMode(serviceName);

    return serviceChannel;
};

ServiceRoutingTable.prototype.transitionChannelToMode =
function transitionChannelToMode(serviceName) {
    var self = this;

    var isExit = self.egressNodes.isExitFor(serviceName);
    var mode = isExit ? 'exit' : 'forward';
    var exitNodes = self.egressNodes.exitsFor(serviceName);

    var serviceChannel = self.channel.subChannels[serviceName];
    serviceChannel.serviceProxyMode = mode; // duck: punched

    if (mode === 'forward') {
        var exitNames = Object.keys(exitNodes);
        for (var i = 0; i < exitNames.length; i++) {
            self._getServicePeer(serviceChannel, exitNames[i]);
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
