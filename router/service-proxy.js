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
var timers = require('timers');
var RelayHandler = require('tchannel/relay_handler');

var DEFAULT_LOG_GRACE_PERIOD = 5 * 60 * 1000;

var CN_HEADER_BUFFER = new Buffer('cn');
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

    self.logGracePeriod = options.logGracePeriod ||
        DEFAULT_LOG_GRACE_PERIOD;
    self.createdAt = Date.now();

    // TODO: port over rate limiter itself
    self.rateLimiterEnabled = false;
}

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

    if (self.isBlocked(cn, serviceName)) {
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
        serviceChannel = self.createServiceChannel(serviceName);
    }

    if (serviceChannel.handler.handleLazily) {
        return serviceChannel.handler.handleLazily(conn, reqFrame);
    } else {
        return false;
    }
};

ServiceDispatchHandler.prototype.isBlocked =
function isBlocked() {
    // TODO: port over real isBlocked()
    return false;
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

ServiceDispatchHandler.prototype.createServiceChannel =
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

    var exitNodes = self.egressNodes.exitsFor(serviceName);
    var isExit = self.egressNodes.isExitFor(serviceName);
    var mode = isExit ? 'exit' : 'forward';

    var choosePeerWithHeap = self.peerHeapEnabledGlobal;
    if (serviceName in self.peerHeapEnabledServices) {
        choosePeerWithHeap = self.peerHeapEnabledServices[serviceName];
    }

    var options = {
        serviceName: serviceName,
        choosePeerWithHeap: choosePeerWithHeap
    };

    if (mode === 'exit') {
        options.preferConnectionDirection = 'out';
    }

    var serviceChannel = self.channel.makeSubChannel(options);
    serviceChannel.serviceProxyMode = mode; // duck: punched

    if (mode === 'forward') {
        var exitNames = Object.keys(exitNodes);
        for (var i = 0; i < exitNames.length; i++) {
            self._getServicePeer(serviceChannel, exitNames[i]);
        }
    }

    serviceChannel.handler = new RelayHandler(
        serviceChannel,
        mode === 'exit' && self.circuitsEnabled && self.circuits);

    return serviceChannel;
};
