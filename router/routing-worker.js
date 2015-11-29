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

var TChannel = require('tchannel');
var extendInto = require('xtend/mutable');

var ServiceProxyHandler = require('./service-proxy-handler.js');
var ServiceRoutingTable = require('./service-routing-table.js');
var DiscoveryBridge = require('./discovery-bridge.js');

module.exports = RoutingWorker;

function RoutingWorker(discoveryWorker, opts) {
    if (!(this instanceof RoutingWorker)) {
        return new RoutingWorker(discoveryWorker, opts);
    }

    var self = this;

    self.discoveryBridge = DiscoveryBridge(discoveryWorker);
    self.logger = self.discoveryBridge.createLogger();
    self.batchStats = self.discoveryBridge.createBatchStats();

    self.tchannel = TChannel(extendInto({
        logger: self.logger,
        batchStats: self.batchStats,
        trace: false,
        emitConnectionMetrics: false,
        connectionStalePeriod: 1.5 * 1000,
        useLazyRelaying: false,
        useLazyHandling: false
    }, opts.testChannelConfigOverlay));

    self.tchannel.drainExempt = isReqDrainExempt;

    self.serviceRoutingTable = new ServiceRoutingTable({
        logger: self.logger,
        channel: self.tchannel,
        discoveryBridge: self.discoveryBridge
    });
    self.serviceProxyHandler = new ServiceProxyHandler({
        logger: self.logger,
        channel: self.tchannel,
        serviceRoutingTable: self.serviceRoutingTable
    });

    self.tchannel.handler = self.serviceProxyHandler;
}

function isReqDrainExempt(req) {
    if (req.serviceName === 'ringpop' ||
        req.serviceName === 'autobahn'
    ) {
        return true;
    }

    return false;
}
