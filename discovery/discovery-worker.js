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
var RingPop = require('ringpop');
var process = require('process');

var setupEndpoints = require('../endpoints/');
var DiscoveryWorkerClients = require('../clients/');
var DrainSignalHandler = require('./drain-signal-handler.js');
var RemoteConfigUpdater = require('./remote-config-update.js');
var HyperbahnHandler = require('../handler.js');
var ServiceProxy = require('./service-proxy.js');
var RoutingWorker = require('../router/routing-worker.js');
var RoutingBridge = require('./routing-bridge.js');

var ExitNode = require('../exit.js');
var EntryNode = require('../entry.js');

var DiscoveryWorkerClientsFailureError = WrappedError({
    type: 'autobahn.app-clients-failed',
    message: 'DiscoveryWorker createClients failed: {origMessage}'
});

module.exports = DiscoveryWorker;

function DiscoveryWorker(config, opts) {
    /*eslint max-statements: [2, 50] */
    if (!(this instanceof DiscoveryWorker)) {
        return new DiscoveryWorker(config, opts);
    }

    var self = this;
    EventEmitter.call(self);

    opts = opts || {};
    self.seedConfig = opts.seedConfig;
    self.seedClients = opts.clients || {};
    self.hostPort = null;
    assert(opts.argv, 'opts.argv is required');

    self.config = config;
    self.clients = DiscoveryWorkerClients({
        config: config,
        argv: opts.argv,
        seedClients: self.seedClients,
        processTitle: opts.processTitle
    });
    self.logger = self.clients.logger;

    var router = RoutingWorker(self, {
        testChannelConfigOverlay: opts.testChannelConfigOverlay
    });
    self.routingBridge = RoutingBridge(router);

    // TODO: holy batman. so naughty.
    self._proxyChannel = router.tchannel;

    // Circuit health monitor and control
    var circuitsConfig = config.get('hyperbahn.circuits');

    var serviceProxyOpts = {
        // TODO: holy batman, so naughty
        channel: self._proxyChannel,
        worker: self,
        logger: self.logger,
        statsd: self.clients.statsd,
        batchStats: self.clients.batchStats,
        egressNodes: self.clients.egressNodes,
        servicePurgePeriod: opts.servicePurgePeriod,
        serviceReqDefaults: opts.serviceReqDefaults,
        rateLimiterEnabled: false,
        defaultTotalKillSwitchBuffer: opts.defaultTotalKillSwitchBuffer,
        rateLimiterBuckets: opts.rateLimiterBuckets,
        circuitsConfig: circuitsConfig,
        partialAffinityEnabled: false,
        minPeersPerRelay: opts.minPeersPerRelay,
        minPeersPerWorker: opts.minPeersPerWorker
    };

    self.serviceProxy = ServiceProxy(serviceProxyOpts);

    // TODO: so naughty
    self.autobahnChannel = self._proxyChannel.makeSubChannel({
        serviceName: 'autobahn'
    });

    self.drainSignalHandler = new DrainSignalHandler({
        logger: self.logger,
        worker: self,
        statsd: self.clients.statsd,
        drainTimeout: self.serviceProxy.drainTimeout
    });
    self.drainSignalHandler.once('shutdown', shutdown);

    self.isBootstrapped = false;
    self.destroyed = false;
    // When we need to force destroy an app to test something,
    // we set this to true. Then we don't throw a 'double
    // destroy' error in destroy().
    self.forceDestroyed = false;
    self.services = {};

    self.remoteConfigUpdate = new RemoteConfigUpdater(self);

    self.clients.remoteConfig.on('update', onRemoteConfigUpdate);
    self.clients.remoteConfig.loadSync();
    onRemoteConfigUpdate();
    self.clients.remoteConfig.startPolling();

    self.ringpop = null;

    function onRemoteConfigUpdate() {
        self.remoteConfigUpdate.onRemoteConfigUpdate();
    }

    function shutdown() {
        self.destroy();
    }
}
inherits(DiscoveryWorker, EventEmitter);

DiscoveryWorker.prototype.hookupSignals =
function hookupSignals() {
    var self = this;

    self.drainSignalHandler.hookupSignals();
};

DiscoveryWorker.prototype.setupServices =
function setupServices() {
    var self = this;

    var hyperbahnTimeouts = self.config.get('hyperbahn.timeouts');
    // TODO: naughty, dont touch self._proxyChannel
    var hyperbahnChannel = self._proxyChannel.makeSubChannel({
        serviceName: 'hyperbahn',
        trace: false
    });
    var hyperbahnHandler = HyperbahnHandler({
        channel: hyperbahnChannel,
        serviceProxy: self.serviceProxy,
        egressNodes: self.clients.egressNodes,
        callerName: 'autobahn',
        relayAdTimeout: hyperbahnTimeouts.relayAdTimeout
    });
    hyperbahnChannel.handler = hyperbahnHandler;

    self.services.exitNode = ExitNode(self);
    self.services.entryNode = EntryNode(self.clients, self);

    setupEndpoints(self, hyperbahnChannel);
};

DiscoveryWorker.prototype.bootstrapTChannel =
function bootstrapTChannel(cb) {
    var self = this;

    self.setupServices();

    // necessary to expose app through repl
    self.clients.repl.setApp(self);
    self.clients.setup(onClientsSetup);

    function onClientsSetup(err) {
        if (err) {
            return cb(err);
        }

        self.routingBridge.listen(
            self.clients._port,
            self.clients._host,
            onListening
        );
    }

    function onListening(err, hostPort) {
        if (err) {
            return cb(err);
        }

        self.hostPort = hostPort;

        cb(null);
    }
};

DiscoveryWorker.prototype.bootstrap = function bootstrap(cb) {
    var self = this;

    if (self.isBootstrapped) {
        throw new Error('double bootstrap');
    }
    self.isBootstrapped = true;

    self.bootstrapTChannel(onChannel);

    function onChannel(err) {
        if (err) {
            return cb(err);
        }

        self.setupRingpop(self.clients.autobahnHostPortList, onClientsReady);
    }

    function onClientsReady(err) {
        /* istanbul ignore next */
        if (err) {
            err = DiscoveryWorkerClientsFailureError(err);
            return cb(err);
        }

        cb(null);
    }
};

DiscoveryWorker.prototype.setupRingpop =
function setupRingpop(hostPortList, cb) {
    var self = this;

    // TODO: naughty ringpop coupling
    var ringpopChannel = self._proxyChannel.makeSubChannel({
        trace: false,
        serviceName: 'ringpop'
    });

    var projectName = self.config.get('info.project');
    var ringpopTimeouts = self.config.get('hyperbahn.ringpop.timeouts');

    self.ringpop = RingPop({
        app: projectName,
        hostPort: self.hostPort,
        channel: ringpopChannel,
        logger: self.logger,
        statsd: self.clients.statsd,
        pingReqTimeout: ringpopTimeouts.pingReqTimeout,
        pingTimeout: ringpopTimeouts.pingTimeout,
        joinTimeout: ringpopTimeouts.joinTimeout
    });
    self.ringpop.statPrefix = 'ringpop.hyperbahn';
    self.ringpop.setupChannel();

    self.clients.egressNodes.setRingpop(self.ringpop);

    if (hostPortList) {
        self.ringpop.bootstrap(hostPortList, cb);
    } else {
        process.nextTick(cb);
    }
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

    self.ringpop.destroy();
    self.serviceProxy.destroy();
    self.routingBridge.destroy();
    self.clients.destroy();
};
