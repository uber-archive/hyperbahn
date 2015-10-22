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

/* global setImmediate */
/* eslint-disable max-statements */

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

// our call SLA is 30 seconds currently
var DEFAULT_DRAIN_TIMEOUT = 30 * 1000;

var RATE_LIMIT_TOTAL = 'total';
var RATE_LIMIT_SERVICE = 'service';
var RATE_LIMIT_KILLSWITCH = 'killswitch';

var CN_HEADER_BUFFER = new Buffer('cn');

function ServiceDispatchHandler(options) {
    if (!(this instanceof ServiceDispatchHandler)) {
        return new ServiceDispatchHandler(options);
    }
    var self = this;

    EventEmitter.call(self);
    self.roleTransitionEvent = self.defineEvent('roleTransition');

    assert(options, 'service dispatch handler options not actually optional');
    self.channel = options.channel;
    self.logger = options.logger || self.channel.logger;
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

    self.servicePurgePeriod = options.servicePurgePeriod ||
        SERVICE_PURGE_PERIOD;
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
    self.drainTimeout = options.drainTimeout || DEFAULT_DRAIN_TIMEOUT;

    self.periodicStatsTimer = null;
    self.statsPeriod = options.statsPeriod || DEFAULT_STATS_PERIOD;

    /* service peer state data structures
     *
     * serviceName  :: string
     * hostPort     :: string
     * lastRefresh  :: number // timestamp
     * exitServices :: Map<serviceName, lastRefresh>
     * peersToReap  :: Map<hostPort, lastRefresh>
     * knownPeers   :: Map<hostPort, lastRefresh>
     */
    self.exitServices = Object.create(null);
    self.peersToReap = Object.create(null);
    self.knownPeers = Object.create(null);

    self.reapPeersTimer = null;
    self.reapPeersPeriod = options.reapPeersPeriod || DEFAULT_REAP_PEERS_PERIOD;

    self.destroyed = false;

    self.egressNodes.on('membershipChanged', onMembershipChanged);

    if (self.circuitsConfig && self.circuitsConfig.enabled) {
        self.enableCircuits();
    }
    self.purgeServices();

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
        self.channel.logger.warn('request missing cn header', conn.extendLogInfo({
            serviceName: serviceName
        }));
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

    var now = self.channel.timers.now();
    var keys = Object.keys(self.exitServices);
    for (var i = 0; i < keys.length; i++) {
        var serviceName = keys[i];
        if (now - self.exitServices[serviceName] > self.servicePurgePeriod) {
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

    var chan = self.getOrCreateServiceChannel(serviceName);
    if (chan.serviceProxyMode !== 'exit') {
        // TODO: stat, log
        return;
    }

    var now = self.channel.timers.now();

    // Reset the expiration time for this service peer
    self.exitServices[serviceName] = now;

    if (self.partialAffinityEnabled) {
        self.refreshServicePeerPartially(serviceName, hostPort, now);
        return;
    }

    // The old way: fully connect every egress to all affine peers.
    self.addPeerIndex(serviceName, hostPort, now);
    var peer = self.getServicePeer(serviceName, hostPort);
    self.ensurePeerConnected(peer, 'service peer refresh');
};

ServiceDispatchHandler.prototype.addPeerIndex =
function addPeerIndex(serviceName, hostPort, now) {
    var self = this;

    // Unmark recently seen peers, so they don't get reaped
    deleteIndexEntry(self.peersToReap, hostPort, serviceName);
    // Mark known peers, so they are candidates for future reaping
    addIndexEntry(self.knownPeers, hostPort, serviceName, now);
};

ServiceDispatchHandler.prototype.deletePeerIndex =
function deletePeerIndex(serviceName, hostPort) {
    var self = this;

    deleteIndexEntry(self.knownPeers, hostPort, serviceName);
};

ServiceDispatchHandler.prototype.ensurePeerConnected =
function ensurePeerConnected(peer, reason) {
    if (peer.isConnected('out')) {
        return;
    }

    peer.connectTo();
};

ServiceDispatchHandler.prototype.computePartialRange =
function computePartialRange(serviceName, hostPort) {
    var self = this;

    var serviceChannel = self.getOrCreateServiceChannel(serviceName);

    var range = {
        relays: null,
        workers: null,
        relayIndex: NaN,
        ratio: NaN,
        start: NaN,
        stop: NaN,
        length: NaN,
        affineWorkers: []
    };

    // Obtain and sort the affine worker and relay lists.
    range.relays = Object.keys(self.egressNodes.exitsFor(serviceName));
    range.relays.sort();
    range.workers = serviceChannel.peers.keys();
    range.workers.sort();

    // Find our position within the affine relay set so we can project that
    // position into the affine worker set.
    range.relayIndex = sortedIndexOf(range.relays, self.channel.hostPort);
    // istanbul ignore if
    if (range.relayIndex < 0) {
        // This should only occur if an advertisement loses the race with a
        // relay ring membership change.
        return range;
    }

    // Compute the range of workers that this relay should be connected to.
    range.ratio = range.workers.length / range.relays.length;
    range.start = Math.floor(range.relayIndex * range.ratio);
    range.length = Math.ceil(
        Math.min(
            range.workers.length,
            Math.max(
                self.minPeersPerRelay,
                self.minPeersPerWorker * range.ratio
            )
        )
    );
    range.stop = (range.start + range.length) % range.workers.length;

    if (range.start === range.stop) {
        // fully connected
        range.affineWorkers = range.workers; // XXX .slice(0)?
    } else if (range.stop < range.start) {
        // wrap-around --> complement
        var head = range.workers.slice(0, range.stop);
        var tail = range.workers.slice(range.start, range.workers.length);
        range.affineWorkers = head.concat(tail);
    } else {
        range.affineWorkers = range.workers.slice(range.start, range.stop);
    }

    return range;
};

ServiceDispatchHandler.prototype.refreshServicePeerPartially =
function refreshServicePeerPartially(serviceName, hostPort, now) {
    var self = this;

    // guaranteed non-null by refreshServicePeer above; we call this only so
    // as not to pass another arg along to the partial path.
    var chan = self.getServiceChannel(serviceName, false);

    var peer = chan.peers.get(hostPort);

    if (!peer) {
        peer = self._getServicePeer(chan, hostPort);
    }

    var range = self.computePartialRange(serviceName, hostPort);
    if (range.relayIndex < 0) {
        self.logger.warn('Relay could not find itself in the affinity set for service', self.extendLogInfo({
            serviceName: serviceName,
            workerHostPort: hostPort,
            partialRange: range
        }));
        // TODO: upgrade two-in-a-row or more to an error
        return;
    }

    if (!range.affineWorkers.length) {
        self.logger.error('empty affineWorkers, this should not happen', self.extendLogInfo({
            serviceName: serviceName,
            advertisingPeer: hostPort,
            partialRange: range
        }));

    }

    var toConnect = [];
    var i;
    var worker;
    for (i = 0; i < range.affineWorkers.length; i++) {
        worker = range.affineWorkers[i];
        toConnect.push(worker);
    }

    self.logger.info('implementing affinity change', self.extendLogInfo({
        serviceName: serviceName,
        newPeer: hostPort,
        partialRange: range,
        toConnect: toConnect
    }));

    self.addPeerIndex(serviceName, hostPort, now);
    self._getServicePeer(chan, hostPort);

    for (i = 0; i < toConnect.length; i++) {
        peer = self._getServicePeer(chan, toConnect[i]);
        self.ensurePeerConnected(peer, 'service peer affinity refresh');
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
    cn = cn || '*';
    serviceName = serviceName || '*';

    if (self.blockingTable &&
        (self.blockingTable[cn + '~~' + serviceName] ||
        self.blockingTable['*~~' + serviceName] ||
        self.blockingTable[cn + '~~*'])) {
        return true;
    }

    if (self.blockingTableRemoteConfig &&
        (self.blockingTableRemoteConfig[cn + '~~' + serviceName] ||
        self.blockingTableRemoteConfig['*~~' + serviceName] ||
        self.blockingTableRemoteConfig[cn + '~~*'])) {
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

ServiceDispatchHandler.prototype.blockRemoteConfig =
function blockRemoteConfig(cn, serviceName) {
    var self = this;
    cn = cn || '*';
    serviceName = serviceName || '*';
    self.blockingTableRemoteConfig = self.blockingTableRemoteConfig || {};
    assert(cn !== '*' || serviceName !== '*', 'at least one of cn/serviceName should be provided');
    self.blockingTableRemoteConfig[cn + '~~' + serviceName] = Date.now();
};

ServiceDispatchHandler.prototype.unblockAllRemoteConfig =
function unblockAllRemoteConfig() {
    var self = this;
    self.blockingTableRemoteConfig = null;
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

    self.logger.info('set peer reap period', self.extendLogInfo({
        period: self.reapPeersPeriod
    }));

    if (self.reapPeersTimer) {
        self.channel.timers.clearTimeout(self.reapPeersTimer);
        self.reapPeersTimer = null;
    }

    self.requestReapPeers();
};

ServiceDispatchHandler.prototype.requestReapPeers =
function requestReapPeers() {
    var self = this;

    if (self.destroyed) {
        return;
    }

    if (self.reapPeersTimer || self.reapPeersPeriod === 0) {
        return;
    }

    self.reapPeersTimer = self.channel.timers.setTimeout(self.boundReapPeers, self.reapPeersPeriod);
};

ServiceDispatchHandler.prototype.reapPeers =
function reapPeers(callback) {
    var self = this;

    if (self.reapPeersTimer) {
        self.channel.timers.clearTimeout(self.reapPeersTimer);
        self.reapPeersTimer = null;
    }

    var peersToReap = Object.keys(self.peersToReap);

    if (peersToReap.length === 0) {
        finish();
        return;
    }

    self.logger.info('reaping dead peers', self.extendLogInfo({
        numPeersToReap: peersToReap.length
    }));

    nextPeer(0, finish);

    function nextPeer(i, done) {
        if (i >= peersToReap.length) {
            finish();
            return;
        }
        self.reapSinglePeer(peersToReap[i]);
        setImmediate(deferNextPeer);

        function deferNextPeer() {
            nextPeer(i + 1, done);
        }
    }

    function finish() {
        self.peersToReap = self.knownPeers;
        self.knownPeers = Object.create(null);

        self.requestReapPeers();

        if (callback) {
            callback();
        }
    }
};

ServiceDispatchHandler.prototype.reapSinglePeer =
function reapSinglePeer(hostPort) {
    var self = this;

    if (!self.peersToReap[hostPort]) {
        return;
    }

    var peer = self.channel.peers.get(hostPort);
    if (!peer) {
        return;
    }

    var serviceNames = Object.keys(self.peersToReap[hostPort]);
    for (var i = 0; i < serviceNames.length; i++) {
        var serviceName = serviceNames[i];
        var svcchan = self.getServiceChannel(serviceName);
        if (!svcchan) {
            return;
        }
        svcchan.peers.delete(hostPort);
        self.deletePeerIndex(serviceName, hostPort);
    }

    // TODO: info log/stat

    peer.drain({
        reason: 'reaped for expired advertisement',
        direction: 'both',
        timeout: self.drainTimeout
    }, disconnectDrainDone);

    function disconnectDrainDone(err) {
        if (err &&
            err.type === 'tchannel.drain.peer.timed-out') {
            // TODO: stat?
            self.logger.warn('forcibly closing reaped peer', self.extendLogInfo({
                timeout: err.timeout,
                elapsed: err.elapsed
            }));
            err = null;
        }
        thenCloseIt(err);
    }

    function thenCloseIt(err) {
        if (err) {
            self.logger.warn('error draining reaped peer, force closing', self.extendLogInfo({
                error: err
            }));
        }
        peer.close(thenDeleteIt);
    }

    function thenDeleteIt(err) {
        if (err) {
            self.logger.warn('error closing reaped peer, deleting it anyhow', self.extendLogInfo({
                error: err
            }));
        }
        self.channel.peers.delete(hostPort);
    }
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
            self.logger.info('circuit became unhealthy',
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

function addIndexEntry(index, keya, keyb, value) {
    var level = index[keya];
    if (!level) {
        level = Object.create(null);
        index[keya] = level;
    }
    level[keyb] = value;
}

function deleteIndexEntry(index, keya, keyb) {
    var level = index[keya];
    if (level && level[keyb]) {
        delete level[keyb];
        if (isObjectEmpty(level)) {
            delete index[keya];
        }
    }
}

/* eslint-disable guard-for-in, no-unused-vars */
function isObjectEmpty(obj) {
    for (var prop in obj) {
        return false;
    }
    return true;
}
/* eslint-enable guard-for-in, no-unused-vars */
