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

var timers = require('timers');
var os = require('os');
var util = require('util');

var BatchStatsd = require('tchannel/lib/statsd');

module.exports = HyperbahnBatchStatsd;

function HyperbahnBatchStatsd(opts) {
    if (!(this instanceof HyperbahnBatchStatsd)) {
        return new HyperbahnBatchStatsd(opts);
    }

    var self = this;

    BatchStatsd.call(self, {
        statsd: opts.statsd,
        logger: opts.logger,
        timers: timers,
        baseTags: {
            app: 'autobahn',
            host: os.hostname()
        }
    });
}
util.inherits(HyperbahnBatchStatsd, BatchStatsd);

HyperbahnBatchStatsd.prototype.handleStat =
function handleStat(stat) {
    /*eslint complexity: [2, 50]*/
    var self = this;

    if (!self.statsd) {
        return;
    } else if (isNullStatsd(self.statsd)) {
        self.writeToStatsd(self.statsd, stat);
        return;
    }

    if (
        stat.name === 'tchannel.inbound.calls.latency' ||
        stat.name === 'tchannel.inbound.calls.recvd'
    ) {
        self.writeToStatsd(self.statsd.globalClient, stat);
        if (
            stat.service === 'autobahn' ||
            stat.callerService === 'autobahn' ||
            stat.service === 'hyperbahn' ||
            stat.callerService === 'hyperbahn'
        ) {
            self.writeToStatsd(self.statsd.perWorkerClient, stat);
        }
    } else if (
        stat.name === 'tchannel.inbound.request.size' ||
        stat.name === 'tchannel.inbound.request.size' ||
        stat.name === 'tchannel.inbound.calls.system-errors' ||
        stat.name === 'tchannel.inbound.response.size' ||
        stat.name === 'tchannel.inbound.calls.success' ||
        stat.name === 'tchannel.inbound.calls.app-errors' ||
        stat.name === 'tchannel.inbound.response.size'
    ) {
        self.writeToStatsd(self.statsd.globalClient, stat);
    } else if (
        stat.name === 'tchannel.outbound.request.size' ||
        stat.name === 'tchannel.outbound.calls.sent' ||
        stat.name === 'tchannel.outbound.request.size' ||
        stat.name === 'tchannel.outbound.calls.per-attempt-latency' ||
        stat.name === 'tchannel.outbound.calls.per-attempt.operational-errors' ||
        stat.name === 'tchannel.outbound.calls.system-errors' ||
        stat.name === 'tchannel.outbound.response.size' ||
        stat.name === 'tchannel.outbound.calls.per-attempt-latency' ||
        stat.name === 'tchannel.outbound.calls.success' ||
        stat.name === 'tchannel.outbound.calls.per-attempt.app-errors' ||
        stat.name === 'tchannel.outbound.response.size'
    ) {
        self.writeToStatsd(self.statsd.globalClient, stat);
    } else {
        self.writeToStatsd(self.statsd, stat);
    }
};

HyperbahnBatchStatsd.prototype.writeToStatsd =
function writeToStatsd(statsd, stat) {
    var self = this;

    var key = stat.tags.toStatKey(stat.name);

    if (stat.type === 'counter') {
        statsd.increment(key, stat.value);
    } else if (stat.type === 'gauge') {
        statsd.gauge(key, stat.value);
    } else if (stat.type === 'timing') {
        statsd.timing(key, stat.value);
    } else {
        self.logger.error('Trying to emit an invalid stat object', {
            statType: stat.type,
            statName: stat.name
        });
    }
};

function isNullStatsd(statsd) {
    return !!statsd._buffer;
}
