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

module.exports = ServiceDispatchHandler;

function ServiceDispatchHandler(options) {
    if (!(this instanceof ServiceDispatchHandler)) {
        return new ServiceDispatchHandler(options);
    }
}

ServiceDispatchHandler.prototype.handleLazily =
function handleLazily(conn, reqFrame) {
    var self = this;

    /*eslint max-statements: [2, 45]*/
    /*eslint complexity: [2, 15]*/

    var res = reqFrame.bodyRW.lazy.readService(reqFrame);
    if (res.err) {
        // TODO: stat?
        self.channel.logger.error(
            'failed to lazy read frame serviceName',
            conn.extendLogInfo({
                error: res.err
            })
        );
        // TODO: protocol error instead?
        conn.sendLazyErrorFrameForReq(reqFrame, 'BadRequest', 'failed to read serviceName');
        return false;
    }

    var serviceName = res.value;
    if (!serviceName) {
        // TODO: reqFrame.extendLogInfo would be nice, especially if it added
        // things like callerName and arg1
        self.channel.logger.error(
            'missing service name in lazy frame',
            conn.extendLogInfo({})
        );
        conn.sendLazyErrorFrameForReq(reqFrame, 'BadRequest', 'missing serviceName');
        return false;
    }

    // TODO: feature support
    // - blocking
    // - rate limiting

    res = reqFrame.bodyRW.lazy.readHeaders(reqFrame);
    if (res.err) {
        // TODO: stat?
        self.channel.logger.warn(
            'failed to lazy read frame headers',
            conn.extendLogInfo({
                error: res.err
            })
        );
        // TODO: protocol error instead?
        conn.sendLazyErrorFrameForReq(reqFrame, 'BadRequest', 'failed to read headers');
        return false;
    }

    var cnBuf = res.value && res.value.getValue(CN_HEADER_BUFFER);
    var cn = cnBuf && cnBuf.toString();
    if (!cn) {
        self.channel.logger.warn(
            'request missing cn header',
            conn.extendLogInfo({
                serviceName: serviceName
            })
        );
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
            self.logger.info(
                'hyperbahn node is rate-limited by the total rps limit',
                self.extendLogInfo(conn.extendLogInfo({
                    rpsLimit: totalLimit,
                    serviceCounters: self.rateLimiter.serviceCounters,
                    edgeCounters: self.rateLimiter.edgeCounters
                }))
            );
            conn.sendLazyErrorFrameForReq(reqFrame, 'Busy', 'hyperbahn node is rate-limited by the total rps of ' + totalLimit);
            return true;
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
            conn.sendLazyErrorFrameForReq(reqFrame, 'Busy', serviceName + ' is rate-limited by the service rps of ' + serviceLimit);
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
