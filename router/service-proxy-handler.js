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

var IntervalScan = require('../lib/interval-scan.js');
var BlockingTable = require('./blocking-table.js');
var RateLimiter = require('../rate_limiter.js');

var CN_HEADER_BUFFER = new Buffer('cn');
var DEFAULT_STATS_PERIOD = 30 * 1000; // every 30 seconds
var RATE_LIMIT_TOTAL = 'total';
var RATE_LIMIT_SERVICE = 'service';
var RATE_LIMIT_KILLSWITCH = 'killswitch';

module.exports = ServiceDispatchHandler;

function ServiceDispatchHandler(options) {
    if (!(this instanceof ServiceDispatchHandler)) {
        return new ServiceDispatchHandler(options);
    }

    var self = this;

    assert(options.logger, 'logger required');
    self.logger = options.logger;

    assert(options.channel, 'channel required');
    self.channel = options.channel;

    assert(options.serviceRoutingTable, 'serviceRoutingTable required');
    self.serviceRoutingTable = options.serviceRoutingTable;

    assert(options.batchStats, 'batchStats required');

    self.rateLimiterEnabled = false;

    self.blockingTable = new BlockingTable();

    self.rateLimiter = new RateLimiter({
        channel: self.channel,
        batchStats: options.batchStats
    });

    self.statEmitter = new IntervalScan({
        name: 'channel-stat-emit',
        interval: options.statsPeriod || DEFAULT_STATS_PERIOD,
        each: function emitEachSubChannelStats(serviceName, serviceChannel) {
            // TODO: only if it's a service channel (relay handler, maybe check
            // for exit mode?)
            self.emitPeriodicServiceStats(serviceChannel, serviceName);
        },
        getCollection: function getSubChannels() {
            return self.channel.subChannels;
        }
    });
    self.statEmitter.start();
}

ServiceDispatchHandler.prototype.type = 'tchannel.hyperbahn.service-dispatch-handler';

/*eslint max-statements: [2, 45]*/
/*eslint complexity: [2, 15]*/
ServiceDispatchHandler.prototype.handleLazily =
function handleLazily(conn, reqFrame) {
    var self = this;

    var res = reqFrame.bodyRW.lazy.readService(reqFrame);
    if (res.err) {
        // TODO: stat?
        // TODO: protocol error instead?
        self.failWithBadRequest(conn, reqFrame,
            'failed to lazy read frame serviceName', res.err);
        return true;
    }

    var serviceName = res.value;
    if (!serviceName) {
        self.failWithBadRequest(conn, reqFrame,
            'missing service name in lazy frame', null);
        return true;
    }

    res = reqFrame.bodyRW.lazy.readHeaders(reqFrame);
    if (res.err) {
        // TODO: stat?
        // TODO: protocol error instead?
        self.failWithBadRequest(conn, reqFrame,
            'failed to lazy read frame headers', res.err);
        return true;
    }

    var cnBuf = res.value && res.value.getValue(CN_HEADER_BUFFER);
    var cn = cnBuf && cnBuf.toString();
    if (!cn) {
        self.failWithBadRequest(conn, reqFrame,
            'request missing cn header', null);
        return true;
    }

    if (self.blockingTable.isBlocked(cn, serviceName)) {
        conn.ops.popInReq(reqFrame.id);
        return true;
    }

    if (self.rateLimiterEnabled) {
        var rateLimitReason = self.rateLimit(cn, serviceName);
        if (rateLimitReason !== null) {
            self.failWithRateLimitReason(
                conn, reqFrame, rateLimitReason, serviceName
            );
            return true;
        }
    }

    var serviceChannel = self.channel.subChannels[serviceName];
    if (!serviceChannel) {
        serviceChannel = self.serviceRoutingTable.createServiceChannel(serviceName);
    }

    if (serviceChannel.handler.handleLazily) {
        return serviceChannel.handler.handleLazily(conn, reqFrame);
    } else {
        return false;
    }
};

ServiceDispatchHandler.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    self.channel.extendLogInfo(info);

    // info.affineServices = Object.keys(self.exitServices);

    // info.circuitsEnabled = self.circuitsEnabled;
    info.rateLimiterEnabled = self.rateLimiterEnabled;
    // info.partialAffinityEnabled = self.partialAffinityEnabled;

    // info.minPeersPerWorker = self.minPeersPerWorker;
    // info.minPeersPerRelay = self.minPeersPerRelay;

    return info;
};

ServiceDispatchHandler.prototype.handleRequest =
function handleRequest(req, buildRes) {
    var self = this;

    if (!req.serviceName) {
        self.logger.warn(
            'Got incoming req with no service',
            self.extendLogInfo(req.extendLogInfo({}))
        );

        buildRes().sendError('BadRequest', 'no service name given');
        return;
    }

    if (self.blockingTable.isBlocked(req.headers && req.headers.cn, req.serviceName)) {
        req.operations.popInReq(req.id);
        return;
    }

    if (self.rateLimiterEnabled) {
        var rateLimitReason = self.rateLimit(req.headers && req.headers.cn, req.serviceName);
        if (rateLimitReason !== null) {
            self.failEagerlyWithRateLimitReason(req, rateLimitReason, buildRes);
            return;
        }
    }

    var serviceChannel = self.channel.subChannels[req.serviceName];
    if (!serviceChannel) {
        serviceChannel = self.serviceRoutingTable.createServiceChannel(req.serviceName);
    }

    serviceChannel.handler.handleRequest(req, buildRes);
};

ServiceDispatchHandler.prototype.failWithBadRequest =
function failWithBadRequest(conn, reqFrame, message, error) {
    var self = this;

    // TODO: reqFrame.extendLogInfo would be nice, especially if it added
    // things like callerName and arg1
    self.logger.error(message, conn.extendLogInfo({
        error: error
    }));

    conn.sendLazyErrorFrameForReq(reqFrame, 'BadRequest', message);
};

ServiceDispatchHandler.prototype.failWithRateLimitReason =
function failWithRateLimitReason(conn, reqFrame, rateLimitReason, serviceName) {
    var self = this;

    if (rateLimitReason === RATE_LIMIT_KILLSWITCH) {
        conn.ops.popInReq(reqFrame.id);
    } else if (rateLimitReason === RATE_LIMIT_TOTAL) {
        var totalLimit = self.rateLimiter.totalRequestCounter.rpsLimit;
        self.logger.info(
            'hyperbahn node is rate-limited by the total rps limit',
            self.extendLogInfo(conn.extendLogInfo({
                rpsLimit: totalLimit,
                serviceCounters: self.rateLimiter.serviceCounters,
                edgeCounters: self.rateLimiter.edgeCounters
            }))
        );
        conn.sendLazyErrorFrameForReq(reqFrame, 'Busy',
            'hyperbahn node is rate-limited by the total rps of ' + totalLimit
        );
    } else if (rateLimitReason === RATE_LIMIT_SERVICE) {
        var serviceLimit = self.rateLimiter.getRpsLimitForService(serviceName);
        self.logger.info(
            'hyperbahn service is rate-limited by the service rps limit',
            self.extendLogInfo(conn.extendLogInfo({
                rpsLimit: serviceLimit,
                serviceCounters: self.rateLimiter.serviceCounters,
                edgeCounters: self.rateLimiter.edgeCounters
            }))
        );
        conn.sendLazyErrorFrameForReq(reqFrame, 'Busy',
            serviceName + ' is rate-limited by the service rps of ' + serviceLimit
        );
    }
};

ServiceDispatchHandler.prototype.failEagerlyWithRateLimitReason =
function failEagerlyWithRateLimitReason(req, rateLimitReason, buildRes) {
    var self = this;

    if (rateLimitReason === RATE_LIMIT_KILLSWITCH) {
        if (req.connection &&
            req.connection.ops) {
            req.connection.ops.popInReq(req.id);
        } else {
            // TODO: needed because TChannelSelfConnection, we can drop
            // this once self connection is dead
            self.logger.warn(
                'rate limiter unable to pop in req, because self connection',
                self.extendLogInfo(req.extendLogInfo({
                    rateLimitReason: RATE_LIMIT_KILLSWITCH
                }))
            );
        }
        return;
    } else if (rateLimitReason === RATE_LIMIT_TOTAL) {
        var totalLimit = self.rateLimiter.totalRequestCounter.rpsLimit;
        self.logger.info(
            'hyperbahn node is rate-limited by the total rps limit',
            self.extendLogInfo(req.extendLogInfo({
                rpsLimit: totalLimit,
                serviceCounters: self.rateLimiter.serviceCounters,
                edgeCounters: self.rateLimiter.edgeCounters
            }))
        );
        buildRes().sendError('Busy', 'hyperbahn node is rate-limited by the total rps of ' + totalLimit);
        return;
    } else if (rateLimitReason === RATE_LIMIT_SERVICE) {
        var serviceLimit = self.rateLimiter.getRpsLimitForService(req.serviceName);
        self.logger.info(
            'hyperbahn service is rate-limited by the service rps limit',
            self.extendLogInfo(req.extendLogInfo({
                rpsLimit: serviceLimit,
                serviceCounters: self.rateLimiter.serviceCounters,
                edgeCounters: self.rateLimiter.edgeCounters
            }))
        );
        buildRes().sendError('Busy', req.serviceName + ' is rate-limited by the rps of ' + serviceLimit);
        return;
    }
};

ServiceDispatchHandler.prototype.rateLimit =
function rateLimit(cn, serviceName) {
    var self = this;

    // stats edge traffic
    self.rateLimiter.incrementEdgeCounter(cn + '~~' + serviceName);

    var isExitNode = self.serviceRoutingTable.isExitFor(serviceName);
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

    return null;
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

ServiceDispatchHandler.prototype.destroy =
function destroy() {
    var self = this;

    self.rateLimiter.destroy();
    self.statEmitter.stop();
};
