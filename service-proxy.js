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
var Buffer = require('buffer').Buffer;
var RelayHandler = require('tchannel/relay_handler');
var EventEmitter = require('tchannel/lib/event_emitter');
var clean = require('tchannel/lib/statsd-clean').clean;
var util = require('util');
var sortedIndexOf = require('./lib/sorted-index-of');

var RateLimiter = require('./rate_limiter.js');
var Circuits = require('./circuits.js');
var CountedReadySignal = require('ready-signal/counted');

var DEFAULT_LOG_GRACE_PERIOD = 5 * 60 * 1000;
var SERVICE_PURGE_PERIOD = 5 * 60 * 1000;
var DEFAULT_MIN_PEERS_PER_WORKER = 5;
var DEFAULT_MIN_PEERS_PER_RELAY = 5;
var DEFAULT_STATS_PERIOD = 30 * 1000; // every 30 seconds
var DEFAULT_REAP_PEERS_PERIOD = 0; // never

var RATE_LIMIT_TOTAL = 'total';
var RATE_LIMIT_SERVICE = 'service';
var RATE_LIMIT_KILLSWITCH = 'killswitch';

var CN_HEADER_BUFFER = new Buffer('cn');

/* eslint max-statements: [2, 40] */
function ServiceDispatchHandler(options) {
    if (!(this instanceof ServiceDispatchHandler)) {
        return new ServiceDispatchHandler(options);
    }
    var self = this;

    EventEmitter.call(self);
    self.roleTransitionEvent = self.defineEvent('roleTransition');

    assert(options, 'service dispatch handler options not actually optional');
    self.channel = options.channel;
    self.logger = options.logger;
    self.statsd = options.statsd;
    self.egressNodes = options.egressNodes;
    self.createdAt = self.channel.timers.now();
    self.logGracePeriod = options.logGracePeriod ||
        DEFAULT_LOG_GRACE_PERIOD;
    self.permissionsCache = options.permissionsCache;
    self.serviceReqDefaults = options.serviceReqDefaults || {};

    self.circuitsEnabled = false;
    self.circuitsConfig = options.circuitsConfig;
    self.circuits = null;
    self.boundOnCircuitStateChange = onCircuitStateChange;
    if (self.circuitsConfig && self.circuitsConfig.enabled) {
        self.enableCircuits();
    }

    self.servicePurgePeriod = options.servicePurgePeriod ||
        SERVICE_PURGE_PERIOD;
    self.exitServices = Object.create(null);
    self.purgeServices();
    self.rateLimiter = new RateLimiter({
        channel: self.channel,
        rpsLimitForServiceName: options.rpsLimitForServiceName,
        exemptServices: options.exemptServices,
        totalRpsLimit: options.totalRpsLimit,
        defaultServiceRpsLimit: options.defaultServiceRpsLimit,
        defaultTotalKillSwitchBuffer: options.defaultTotalKillSwitchBuffer,
        numOfBuckets: options.rateLimiterBuckets
    });
    self.rateLimiterEnabled = options.rateLimiterEnabled;

    self.partialAffinityEnabled = options.partialAffinityEnabled;
    self.minPeersPerWorker = options.minPeersPerWorker || DEFAULT_MIN_PEERS_PER_WORKER;
    self.minPeersPerRelay = options.minPeersPerRelay || DEFAULT_MIN_PEERS_PER_RELAY;

    self.periodicStatsTimer = null;
    self.statsPeriod = options.statsPeriod || DEFAULT_STATS_PERIOD;

    self.peersToReap = Object.create(null);
    self.connectedPeers = Object.create(null);
    self.reapPeersTimer = null;
    self.reapPeersPeriod = options.reapPeersPeriod || DEFAULT_REAP_PEERS_PERIOD;

    self.destroyed = false;

    self.egressNodes.on('membershipChanged', onMembershipChanged);

    self.boundReapPeers = reapPeers;
    function reapPeers() {
        self.reapPeers();
    }

    self.boundEmitPeriodicStats = emitPeriodicStats;
    function emitPeriodicStats() {
        self.emitPeriodicStats();
    }

    function onCircuitStateChange(stateChange) {
        self.onCircuitStateChange(stateChange);
    }

    function onMembershipChanged() {
        self.updateServiceChannels();
    }

    self.requestReapPeers();
    self.emitPeriodicStats();
}

util.inherits(ServiceDispatchHandler, EventEmitter);

ServiceDispatchHandler.prototype.type = 'tchannel.hyperbahn.service-dispatch-handler';

ServiceDispatchHandler.prototype.handleLazily =
function handleLazily(conn, reqFrame) {
    var self = this;

    /*eslint max-statements: [2, 45]*/
    /*eslint complexity: [2, 15]*/

    var res = reqFrame.bodyRW.lazy.readService(reqFrame);
    if (res.err) {
        // TODO: stat?
        self.channel.logger.error('failed to lazy read frame serviceName', conn.extendLogInfo({
            error: res.err
        }));
        // TODO: protocol error instead?
        conn.sendLazyErrorFrameForReq(reqFrame, 'BadRequest', 'failed to read serviceName');
        return false;
    }

    var serviceName = res.value;
    if (!serviceName) {
        // TODO: reqFrame.extendLogInfo would be nice, especially if it added
        // things like callerName and arg1
        self.channel.logger.error('missing service name in lazy frame', conn.extendLogInfo({}));
        conn.sendLazyErrorFrameForReq(reqFrame, 'BadRequest', 'missing serviceName');
        return false;
    }

    // TODO: feature support
    // - blocking
    // - rate limiting

    res = reqFrame.bodyRW.lazy.readHeaders(reqFrame);
    if (res.err) {
        // TODO: stat?
        self.channel.logger.warn('failed to lazy read frame headers', conn.extendLogInfo({
            error: res.err
        }));
        // TODO: protocol error instead?
        conn.sendLazyErrorFrameForReq(reqFrame, 'BadRequest', 'failed to read headers');
        return false;
    }

    var cnBuf = res.value && res.value.getValue(CN_HEADER_BUFFER);
    var cn = cnBuf && cnBuf.toString();
    if (!cn) {
        self.channel.logger.error('request missing cn header', conn.extendLogInfo({}));
        conn.sendLazyErrorFrameForReq(reqFrame, 'BadRequest', 'missing cn header');
        return false;
    }

    if (self.isBlocked(cn, serviceName)) {
        conn.ops.popInReq(reqFrame.id);
        return null;
    }

    if (self.rateLimiterEnabled) {
        var rateLimitReason = self.rateLimit(cn, serviceName);

        if (rateLimitReason === RATE_LIMIT_KILLSWITCH) {
            conn.ops.popInReq(reqFrame.id);
            return true;
        } else if (rateLimitReason === RATE_LIMIT_TOTAL) {
            var totalLimit = self.rateLimiter.totalRequestCounter.rpsLimit;
            self.logger.info('hyperbahn node is rate-limited by the total rps limit', self.extendLogInfo(conn.extendLogInfo({
                rpsLimit: totalLimit,
                serviceCounters: self.rateLimiter.serviceCounters,
                edgeCounters: self.rateLimiter.edgeCounters
            })));
            conn.sendLazyErrorFrameForReq(reqFrame, 'Busy', 'hyperbahn node is rate-limited by the total rps of ' + totalLimit);
            return true;
        } else if (rateLimitReason === RATE_LIMIT_SERVICE) {
            var serviceLimit = self.rateLimiter.getRpsLimitForService(serviceName);
            self.logger.info('hyperbahn service is rate-limited by the service rps limit', self.extendLogInfo(conn.extendLogInfo({
                    rpsLimit: serviceLimit,
                    serviceCounters: self.rateLimiter.serviceCounters,
                    edgeCounters: self.rateLimiter.edgeCounters
                })));
            conn.sendLazyErrorFrameForReq(reqFrame, 'Busy', serviceName + ' is rate-limited by the rps of ' + serviceLimit);
            return true;
        }
    }

    var chan = self.channel.subChannels[serviceName];
    if (!chan) {
        chan = self.createServiceChannel(serviceName);
    }

    if (chan.handler.handleLazily) {
        return chan.handler.handleLazily(conn, reqFrame);
    } else {
        return false;
    }
};

ServiceDispatchHandler.prototype.handleRequest =
function handleRequest(req, buildRes) {
    var self = this;

    if (!req.serviceName) {
        self.logger.warn('Got incoming req with no service',
            self.extendLogInfo(req.extendLogInfo({})));

        buildRes().sendError('BadRequest', 'no service name given');
        return;
    }

    if (self.isBlocked(req.headers && req.headers.cn, req.serviceName)) {
        req.operations.popInReq(req.id);
        return;
    }

    if (self.rateLimiterEnabled) {
        var rateLimitReason = self.rateLimit(req.headers && req.headers.cn, req.serviceName);
        if (rateLimitReason === RATE_LIMIT_KILLSWITCH) {
            req.connection.ops.popInReq(req.id);
            return;
        } else if (rateLimitReason === RATE_LIMIT_TOTAL) {
            var totalLimit = self.rateLimiter.totalRequestCounter.rpsLimit;
            self.logger.info('hyperbahn node is rate-limited by the total rps limit',
                self.extendLogInfo(req.extendLogInfo({
                    rpsLimit: totalLimit,
                    serviceCounters: self.rateLimiter.serviceCounters,
                    edgeCounters: self.rateLimiter.edgeCounters
                })));
            buildRes().sendError('Busy', 'hyperbahn node is rate-limited by the total rps of ' + totalLimit);
            return;
        } else if (rateLimitReason === RATE_LIMIT_SERVICE) {
            var serviceLimit = self.rateLimiter.getRpsLimitForService(req.serviceName);
            self.logger.info('hyperbahn service is rate-limited by the service rps limit',
                self.extendLogInfo(req.extendLogInfo({
                    rpsLimit: serviceLimit,
                    serviceCounters: self.rateLimiter.serviceCounters,
                    edgeCounters: self.rateLimiter.edgeCounters
                })));
            buildRes().sendError('Busy', req.serviceName + ' is rate-limited by the rps of ' + serviceLimit);
            return;
        }
    }

    var chan = self.channel.subChannels[req.serviceName];
    if (!chan) {
        chan = self.createServiceChannel(req.serviceName);
    }

    // Temporary hack. Need to set json by default because
    // we want to upgrade without breaking ncar
    chan.handler.handleRequest(req, buildRes);
};

ServiceDispatchHandler.prototype.rateLimit =
function rateLimit(cn, serviceName) {
    var self = this;

    // stats edge traffic
    self.rateLimiter.incrementEdgeCounter(cn + '~~' + serviceName);

    var isExitNode = self.isExitFor(serviceName);
    if (isExitNode) {
        self.rateLimiter.createServiceCounter(serviceName);
        self.rateLimiter.createKillSwitchServiceCounter(serviceName);
    }

    // apply kill switch safe guard first
    if (self.rateLimiter.shouldKillSwitchTotalRequest(serviceName) ||
        (isExitNode && self.rateLimiter.shouldKillSwitchService(serviceName))) {
        return RATE_LIMIT_KILLSWITCH;
    }

    self.rateLimiter.incrementKillSwitchTotalCounter(serviceName);
    if (isExitNode) {
        self.rateLimiter.incrementKillSwitchServiceCounter(serviceName);
    }

    // apply rate limiter
    if (self.rateLimiter.shouldRateLimitTotalRequest(serviceName)) {
        return RATE_LIMIT_TOTAL;
    }

    // check RPS for service limit
    if (isExitNode && self.rateLimiter.shouldRateLimitService(serviceName)) {
        return RATE_LIMIT_SERVICE;
    }

    // increment the counters
    self.rateLimiter.incrementTotalCounter(serviceName);
    if (isExitNode) {
        self.rateLimiter.incrementServiceCounter(serviceName);
    }

    return '';
};

ServiceDispatchHandler.prototype.getOrCreateServiceChannel =
function getOrCreateServiceChannel(serviceName) {
    var self = this;
    return self.getServiceChannel(serviceName, true);
};

ServiceDispatchHandler.prototype.getServiceChannel =
function getServiceChannel(serviceName, create) {
    var self = this;
    var svcchan = self.channel.subChannels[serviceName];
    if (!svcchan && create) {
        svcchan = self.createServiceChannel(serviceName);
    }
    return svcchan;
};

ServiceDispatchHandler.prototype.getServicePeer =
function getServicePeer(serviceName, hostPort) {
    var self = this;
    var svcchan = self.getOrCreateServiceChannel(serviceName);
    return self._getServicePeer(svcchan, hostPort);
};

ServiceDispatchHandler.prototype._getServicePeer =
function _getServicePeer(svcchan, hostPort) {
    var peer = svcchan.peers.get(hostPort);
    if (!peer) {
        peer = svcchan.peers.add(hostPort);
    }
    if (!peer.serviceProxyServices) {
        peer.serviceProxyServices = {};
    }
    peer.serviceProxyServices[svcchan.serviceName] = true;
    return peer;
};

ServiceDispatchHandler.prototype.createServiceChannel =
function createServiceChannel(serviceName) {
    var self = this;

    var now = self.channel.timers.now();
    if (now >= self.createdAt + self.logGracePeriod) {
        self.logger.info('Creating new sub channel', self.extendLogInfo({
            serviceName: serviceName
        }));
    }

    var exitNodes = self.egressNodes.exitsFor(serviceName);
    var isExit = self.egressNodes.isExitFor(serviceName);
    var mode = isExit ? 'exit' : 'forward';

    var options = {
        serviceName: serviceName
    };
    if (self.serviceReqDefaults[serviceName]) {
        options.requestDefaults = self.serviceReqDefaults[serviceName];
    }

    if (mode === 'exit') {
        options.preferConnectionDirection = 'out';
    }

    var svcchan = self.channel.makeSubChannel(options);
    svcchan.serviceProxyMode = mode; // duck: punched

    if (mode === 'forward') {
        var exitNames = Object.keys(exitNodes);
        for (var i = 0; i < exitNames.length; i++) {
            self._getServicePeer(svcchan, exitNames[i]);
        }
    }

    svcchan.handler = new RelayHandler(
        svcchan,
        mode === 'exit' && self.circuitsEnabled && self.circuits);

    return svcchan;
};

ServiceDispatchHandler.prototype.purgeServices =
function purgeServices() {
    var self = this;

    var time = self.channel.timers.now();
    var keys = Object.keys(self.exitServices);
    for (var i = 0; i < keys.length; i++) {
        var serviceName = keys[i];
        if (time - self.exitServices[serviceName] > self.servicePurgePeriod) {
            delete self.exitServices[serviceName];
            var chan = self.channel.subChannels[serviceName];
            if (chan) {
                chan.close();
                delete self.channel.subChannels[serviceName];
                self.rateLimiter.removeServiceCounter(serviceName);
                self.rateLimiter.removeKillSwitchCounter(serviceName);
            }
        }
    }

    self.servicePurgeTimer = self.channel.timers.setTimeout(
        function purgeServices() {
            self.purgeServices();
        },
        self.servicePurgePeriod
    );
};

ServiceDispatchHandler.prototype.refreshServicePeer =
function refreshServicePeer(serviceName, hostPort) {
    var self = this;

    var chan = self.channel.subChannels[serviceName];
    if (!chan) {
        chan = self.createServiceChannel(serviceName);
    }
    if (chan.serviceProxyMode !== 'exit') {
        // TODO: stat, log
        return;
    }

    // Create a peer for the worker.
    // This is necessary for populating the worker pool regardless of whether
    // we connect.
    // TODO This belies an underlying assumption that the peer pool includes
    // exactly and only the worker pool, that we would eventually reap peers
    // that have not advertised recently.
    var peer = self.getServicePeer(serviceName, hostPort);

    // Reset the expiration time for this service peer
    var time = self.channel.timers.now();
    self.exitServices[serviceName] = time;

    if (self.partialAffinityEnabled) {
        self.refreshServicePeerPartially(serviceName, hostPort);
        return;
    }

    // The old way: fully connect every egress to all affine peers.
    peer.connectTo();

    // Unmark recently seen peers, so they don't get reaped
    delete self.peersToReap[hostPort];
    // Mark known peers, so they are candidates for future reaping
    if (!self.connectedPeers[hostPort]) {
        self.connectedPeers[hostPort] = Object.create(null);
    }
    self.connectedPeers[hostPort][serviceName] = true;
};

ServiceDispatchHandler.prototype.refreshServicePeerPartially =
function refreshServicePeerPartially(serviceName, hostPort) {
    var self = this;

    // Obtain and sort the affine worker and relay lists.
    var relays = Object.keys(self.egressNodes.exitsFor(serviceName));
    relays.sort();
    var serviceChannel = self.getOrCreateServiceChannel(serviceName);
    var workers = serviceChannel.peers.keys();
    workers.sort();

    // Find our position within the affine relay set so we can project that
    // position into the affine worker set.
    var relayIndex = sortedIndexOf(relays, self.channel.hostPort);
    // istanbul ignore if
    if (relayIndex < 0) {
        // This should only occur if an advertisement loses the race with a
        // relay ring membership change.
        self.logger.warn('Relay could not find itself in the affinity set for service', self.extendLogInfo({
            serviceName: serviceName,
            relayHostPort: self.channel.hostPort,
            workerHostPort: hostPort,
            relays: relays,
            workers: workers
        }));
        return;
    }

    // Compute the range of workers that this relay should be connected to.
    var ratio = workers.length / relays.length;
    var start = Math.floor(relayIndex * ratio);
    var length = Math.ceil(
        Math.min(
            workers.length,
            Math.max(
                self.minPeersPerRelay,
                self.minPeersPerWorker * ratio
            )
        )
    );
    var stop = (start + length) % workers.length;

    self.logger.info('Refreshing service peer affinity', self.extendLogInfo({
        serviceName: serviceName,
        serviceHostPort: hostPort,
        relayIndex: relayIndex,
        relays: relays,
        workers: workers,
        start: start,
        stop: stop,
        length: length
    }));

    // Open connections to affine peers
    var index;
    var peer;
    if (start <= stop) { // ... start WITHIN stop ...
        for (index = start; index < stop; index++) {
            peer = self.getServicePeer(serviceName, workers[index]);
            peer.connectTo();
        }
    } else { // BEFORE stop ... start AFTER
        for (index = start; index < workers.length; index++) {
            peer = self.getServicePeer(serviceName, workers[index]);
            peer.connectTo();
        }
        for (index = 0; index < stop; index++) {
            peer = self.getServicePeer(serviceName, workers[index]);
            peer.connectTo();
        }
    }

    // TODO Drop peers that no longer have affinity for this service, such
    // that they may be elligible for having their connections reaped.
};

ServiceDispatchHandler.prototype.removeServicePeer =
function removeServicePeer(serviceName, hostPort) {
    var self = this;

    var svcchan = self.channel.subChannels[serviceName];
    if (!svcchan) {
        return;
    }

    var peer = self.channel.peers.get(hostPort);
    if (!peer) {
        return;
    }
    svcchan.peers.delete(hostPort);

    var anyOtherSubChan = false;
    var subChanKeys = Object.keys(self.channel.subChannels);
    for (var i = 0; i < subChanKeys; i++) {
        var subChan = self.channel.subChannels[subChanKeys[i]];
        if (subChan.peers.get(hostPort)) {
            anyOtherSubChan = true;
            break;
        }
    }

    if (!anyOtherSubChan) {
        var allDrained = CountedReadySignal(peer.connections.length + 1);
        allDrained(onAllDrained);
        for (var j = 0; j < peer.connections.length; j++) {
            peer.connections[j].drain('closing due to unadvertisement', allDrained.signal);
        }
        allDrained.signal();
    }

    function onAllDrained() {
        self.logger.info('Peer drained and closed due to unadvertisement', peer.extendLogInfo({
            serviceName: serviceName
        }));
        peer.close(noop);
        self.channel.peers.delete(hostPort);
    }
};

function noop() {}

ServiceDispatchHandler.prototype.updateServiceChannels =
function updateServiceChannels() {
    var self = this;
    var serviceNames = Object.keys(self.channel.subChannels);
    for (var i = 0; i < serviceNames.length; i++) {
        var serviceName = serviceNames[i];
        var chan = self.channel.subChannels[serviceName];
        if (chan.serviceProxyMode) {
            self.updateServiceChannel(chan);
        }
    }

    if (self.circuits) {
        self.circuits.updateServices();
    }
};

ServiceDispatchHandler.prototype.updateServiceChannel =
function updateServiceChannel(svcchan) {
    var self = this;
    var exitNodes = self.egressNodes.exitsFor(svcchan.serviceName);
    var isExit = self.egressNodes.isExitFor(svcchan.serviceName);
    if (isExit && svcchan.serviceProxyMode === 'forward') {
        self.changeToExit(exitNodes, svcchan);
    } else if (!isExit) {
        if (svcchan.serviceProxyMode === 'exit') {
            self.changeToForward(exitNodes, svcchan);
        } else {
            self.updateExitNodes(exitNodes, svcchan);
        }
    }
};

ServiceDispatchHandler.prototype.changeToExit =
function changeToExit(exitNodes, svcchan) {
    var self = this;

    var oldMode = svcchan.serviceProxyMode;
    svcchan.serviceProxyMode = 'exit';
    svcchan.peers.clear();
    self.roleTransitionEvent.emit(self, {
        svcchan: svcchan,
        oldMode: oldMode,
        newMode: 'exit'
    });

    self.logger.info('Changing to exit node', self.extendLogInfo({
        oldMode: oldMode,
        newMode: 'exit',
        serviceName: svcchan.serviceName
    }));
};

ServiceDispatchHandler.prototype.changeToForward =
function changeToForward(exitNodes, svcchan) {
    var self = this;
    var oldMode = svcchan.serviceProxyMode;
    svcchan.serviceProxyMode = 'forward';

    // TODO make sure we close all connections.
    svcchan.peers.clear();
    // TODO: transmit prior known registration data to new owner(s) to
    // speed convergence / deal with transitions better:
    //     var oldHostPorts = svcchan.peers.keys();
    //     var oldPeers = svcchan.peers.values();
    //     svcchan.peers.clear();
    //     ... send rpc to new exit nodes
    var exitNames = Object.keys(exitNodes);
    for (var i = 0; i < exitNames.length; i++) {
        self._getServicePeer(svcchan, exitNames[i]);
    }
    self.roleTransitionEvent.emit(self, {
        svcchan: svcchan,
        oldMode: oldMode,
        newMode: 'forward'
    });

    self.logger.info('Changing to forward node', self.extendLogInfo({
        oldMode: oldMode,
        newMode: 'forward',
        serviceName: svcchan.serviceName
    }));
};

ServiceDispatchHandler.prototype.updateExitNodes =
function updateExitNodes(exitNodes, svcchan) {
    var self = this;
    var i;
    var oldNames = svcchan.peers.keys();
    for (i = 0; i < oldNames.length; i++) {
        if (!exitNodes[oldNames[i]]) {
            svcchan.peers.delete(oldNames[i]);
        }
    }
    var exitNames = Object.keys(exitNodes);
    for (i = 0; i < exitNames.length; i++) {
        self._getServicePeer(svcchan, exitNames[i]);
    }
};

ServiceDispatchHandler.prototype.isBlocked =
function isBlocked(cn, serviceName) {
    var self = this;
    if (!self.blockingTable) {
        return false;
    }

    cn = cn || '*';
    serviceName = serviceName || '*';

    if (self.blockingTable[cn + '~~' + serviceName] ||
        self.blockingTable['*~~' + serviceName] ||
        self.blockingTable[cn + '~~*']) {
        return true;
    }

    return false;
};

ServiceDispatchHandler.prototype.block =
function block(cn, serviceName) {
    var self = this;
    cn = cn || '*';
    serviceName = serviceName || '*';
    self.blockingTable = self.blockingTable || {};
    assert(cn !== '*' || serviceName !== '*', 'at least one of cn/serviceName should be provided');
    self.blockingTable[cn + '~~' + serviceName] = Date.now();
};

ServiceDispatchHandler.prototype.unblock =
function unblock(cn, serviceName) {
    var self = this;
    if (!self.blockingTable) {
        return;
    }

    cn = cn || '*';
    serviceName = serviceName || '*';
    delete self.blockingTable[cn + '~~' + serviceName];
    if (Object.keys(self.blockingTable).length === 0) {
        self.blockingTable = null;
    }
};

ServiceDispatchHandler.prototype.isExitFor =
function isExitFor(serviceName) {
    var self = this;

    // faster check than calls into ringpop
    var chan = self.channel.subChannels[serviceName];
    if (!chan) {
        return self.egressNodes.isExitFor(serviceName);
    }

    return chan.serviceProxyMode === 'exit';
};

ServiceDispatchHandler.prototype.emitPeriodicStats =
function emitPeriodicStats() {
    var self = this;
    self.periodicStatsTimer = null;

    var serviceNames = Object.keys(self.channel.subChannels);
    for (var index = 0; index < serviceNames.length; index++) {
        var serviceName = serviceNames[index];
        var serviceChannel = self.channel.subChannels[serviceName];
        self.emitPeriodicServiceStats(serviceChannel, serviceName);
    }

    self.requestPeriodicStats();
};

ServiceDispatchHandler.prototype.requestPeriodicStats =
function requestPeriodicStats() {
    var self = this;
    if (self.periodicStatsTimer || self.destroyed) {
        return;
    }
    self.periodicStatsTimer = self.channel.timers.setTimeout(self.boundEmitPeriodicStats, self.statsPeriod);
};

ServiceDispatchHandler.prototype.setReapPeersPeriod =
function setReapPeersPeriod(period) {
    // period === 0 means never / disabled, and is the default
    var self = this;
    if (self.reapPeersPeriod === period) {
        return;
    }
    self.reapPeersPeriod = period;
    if (self.reapPeersTimer) {
        self.channel.timers.clearTimeout(self.reapPeersTimer);
        self.reapPeersTimer = null;
    }
    if (period !== 0) {
        self.reapPeers();
        // This will also establish the next timer
    }
};

ServiceDispatchHandler.prototype.requestReapPeers =
function requestReapPeers() {
    var self = this;
    if (self.reapPeersTimer || self.reapPeersPeriod === 0 || self.destroyed) {
        return;
    }
    self.reapPeersTimer = self.channel.timers.setTimeout(self.boundReapPeers, self.reapPeersPeriod);
};

ServiceDispatchHandler.prototype.reapPeers =
function reapPeers() {
    var self = this;

    var i;
    var j;

    self.logger.info('Reaping dead peers', self.extendLogInfo({
        peers: self.peersToReap
    }));

    var peersToReap = Object.keys(self.peersToReap);
    for (i = 0; i < peersToReap.length; i++) {
        var hostPort = peersToReap[i];
        var peer = self.channel.peers.get(hostPort);
        for (j = 0; j < peer.connections.length; j++) {
            var connection = peer.connections[j];
            connection.drain('reaped for expired advertisement');
        }

        var serviceNames = Object.keys(self.peersToReap[hostPort]);
        for (j = 0; j < serviceNames.length; j++) {
            var serviceName = serviceNames[j];
            var svcchan = self.getServiceChannel(serviceName);
            if (!svcchan) {
                continue;
            }
            svcchan.peers.delete(hostPort);
        }

        self.channel.peers.delete(hostPort);
    }

    self.peersToReap = self.connectedPeers;
    self.connectedPeers = Object.create(null);

    self.requestReapPeers();
};

ServiceDispatchHandler.prototype.emitPeriodicServiceStats =
function emitPeriodicServiceStats(serviceChannel, serviceName) {
    var self = this;

    var incoming = 0;
    var outgoing = 0;
    var anyway = 0;

    var prefix = 'services.' + clean(serviceName, 'no-service') + '.';

    var hostPorts = serviceChannel.peers.keys();
    for (var i = 0; i < hostPorts.length; i++) {
        var hostPort = hostPorts[i];
        var peer = serviceChannel.peers.get(hostPort);
        anyway += peer.connections.length;
        for (var j = 0; j < peer.connections.length; j++) {
            var connection = peer.connections[j];
            if (connection.direction === 'in') {
                incoming++;
            } else if (connection.direction === 'out') {
                outgoing++;
            }
        }
    }

    self.statsd.gauge(prefix + 'peers', hostPorts.length);
    self.statsd.gauge(prefix + 'connections.in', incoming);
    self.statsd.gauge(prefix + 'connections.out', outgoing);
    self.statsd.gauge(prefix + 'connections.any', anyway);
};

ServiceDispatchHandler.prototype.onCircuitStateChange =
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
            self.logger.info('circuit returned to good health',
                self.extendLogInfo(circuit.extendLogInfo({})));
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
            self.logger.warn('circuit became unhealthy',
                self.extendLogInfo(circuit.extendLogInfo({})));
        }
    }
};

ServiceDispatchHandler.prototype.destroy =
function destroy() {
    var self = this;
    if (self.destroyed) {
        return;
    }
    self.destroyed = true;
    self.channel.timers.clearTimeout(self.servicePurgeTimer);
    self.channel.timers.clearTimeout(self.reapPeersTimer);
    self.channel.timers.clearTimeout(self.periodicStatsTimer);
    self.rateLimiter.destroy();
};

ServiceDispatchHandler.prototype.initCircuits =
function initCircuits() {
    var self = this;

    self.circuits = new Circuits({
        timeHeap: self.channel.timeHeap,
        timers: self.channel.timers,
        random: self.random,
        egressNodes: self.egressNodes,
        config: self.circuitsConfig
    });

    self.circuits.circuitStateChangeEvent.on(self.boundOnCircuitStateChange);
};

ServiceDispatchHandler.prototype.enableCircuits =
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

ServiceDispatchHandler.prototype.disableCircuits =
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

ServiceDispatchHandler.prototype.enableRateLimiter =
function enableRateLimiter() {
    var self = this;
    self.rateLimiterEnabled = true;
};

ServiceDispatchHandler.prototype.disableRateLimiter =
function disableRateLimiter() {
    var self = this;
    self.rateLimiterEnabled = false;
};

ServiceDispatchHandler.prototype.enablePartialAffinity =
function enablePartialAffinity() {
    var self = this;
    self.partialAffinityEnabled = true;
};

ServiceDispatchHandler.prototype.disablePartialAffinity =
function disablePartialAffinity() {
    var self = this;
    self.partialAffinityEnabled = false;
};

ServiceDispatchHandler.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    self.channel.extendLogInfo(info);

    info.affineServices = Object.keys(self.exitServices);

    info.circuitsEnabled = self.circuitsEnabled;
    info.rateLimiterEnabled = self.rateLimiterEnabled;
    info.partialAffinityEnabled = self.partialAffinityEnabled;

    info.minPeersPerWorker = self.minPeersPerWorker;
    info.minPeersPerRelay = self.minPeersPerRelay;

    return info;
};

// TODO Consider sharding by hostPort and indexing exit exitNodes by hostPort.
// We also have to shard by serviceName and store the serviceName <-> hostPort
// information under the "service exitNodes".  This means that sharding by
// hostPort gives an even spread of socket distribution. i.e. if we shard
// dispatch to 5 exit exitNodes and some small lulzy service to 5 exit
// exitNodes we wont have massive imbalance of dispatch having 500 workers and
// the small service having 2 workers.  We would need two hops to find an exit
// node though

module.exports = ServiceDispatchHandler;
