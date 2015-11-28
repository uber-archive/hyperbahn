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

var inherits = require('inherits');
var EventEmitter = require('events').EventEmitter;
var WrappedError = require('error/wrapped');
var assert = require('assert');
var process = require('process');

var setupEndpoints = require('../endpoints/');
var DiscoveryWorkerClients = require('../clients/');

var ExitNode = require('../exit.js');
var EntryNode = require('../entry.js');

var DiscoveryWorkerClientsFailureError = WrappedError({
    type: 'autobahn.app-clients-failed',
    message: 'DiscoveryWorker createClients failed: {origMessage}'
});

module.exports = DiscoveryWorker;

function DiscoveryWorker(config, opts) {
    if (!(this instanceof DiscoveryWorker)) {
        return new DiscoveryWorker(config, opts);
    }

    var self = this;
    EventEmitter.call(self);

    opts = opts || {};
    self.seedConfig = opts.seedConfig;
    self.seedClients = opts.clients || {};
    assert(opts.argv, 'opts.argv is required');

    self.clients = DiscoveryWorkerClients({
        config: config,
        argv: opts.argv,
        seedClients: self.seedClients,
        processTitle: opts.processTitle,

        serviceReqDefaults: opts.serviceReqDefaults,
        servicePurgePeriod: opts.servicePurgePeriod,
        period: opts.period,
        maxErrorRate: opts.maxErrorRate,
        minRequests: opts.minRequests,
        probation: opts.probation,
        defaultTotalKillSwitchBuffer: opts.defaultTotalKillSwitchBuffer,
        rateLimiterBuckets: opts.rateLimiterBuckets,
        testChannelConfigOverlay: opts.channelTestConfigOverlay
    });
    self.services = null;
    self.logger = self.clients.logger;
    self.tchannel = self.clients.tchannel;
    self.drainDeadlineTimer = null;
    self.drainStart = null;
    self.drainEnd = null;

    self.tchannel.drainExempt = function isReqDrainExempt(req) {
        if (req.serviceName === 'ringpop' ||
            req.serviceName === 'autobahn'
        ) {
            return true;
        }

        return false;
    };

    self.isBootstrapped = false;

    // internal because its already deprecated
    self._controlServer = null;

    self.destroyed = false;
    // When we need to force destroy an app to test something,
    // we set this to true. Then we don't throw a 'double
    // destroy' error in destroy().
    self.forceDestroyed = false;
}

inherits(DiscoveryWorker, EventEmitter);

DiscoveryWorker.prototype.setupServices = function setupServices() {
    var self = this;

    self.services = {};
    self.services.exitNode = ExitNode(self.clients);
    self.services.entryNode = EntryNode(self.clients);

    setupEndpoints(self.clients, self.services);
};

DiscoveryWorker.prototype.bootstrap = function bootstrap(cb) {
    var self = this;

    if (self.isBootstrapped) {
        throw new Error('double bootstrap');
    }
    self.isBootstrapped = true;

    self.setupServices();

    self.clients.bootstrap(onClientsReady);

    function onClientsReady(err) {
        /* istanbul ignore next */
        if (err) {
            err = DiscoveryWorkerClientsFailureError(err);
            return cb(err);
        }

        // necessary to expose app through repl
        self.clients.repl.setApp(self);

        cb(null);
    }
};

DiscoveryWorker.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    info = self.tchannel.extendLogInfo(info);

    return info;
};

// TODO: remove, unecessary
DiscoveryWorker.prototype.bootstrapAndListen =
function bootstrapAndListen(callback) {
    var self = this;

    self.bootstrap(callback);
};

DiscoveryWorker.prototype.destroy = function destroy(opts) {
    var self = this;

    if (self.destroyed && !self.forceDestroyed) {
        throw new Error('double destroy');
    } else if (self.forceDestroyed) {
        // We were already destroyed
        return;
    }

    if (opts && opts.force) {
        self.forceDestroyed = true;
    }

    self.destroyed = true;

    self.clients.destroy();
};
