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
var IntervalScan = require('./lib/interval-scan.js');

// Default prune period of 1 min
var DEFAULT_PRUNE_BAN_LIST_PERIOD = 60 * 1000;

module.exports = InstanceBanList;

function InstanceBanList(options) {
    if (!(this instanceof InstanceBanList)) {
        return new InstanceBanList(options);
    }

    var self = this;

    self.channel = options.channel;
    assert(
        typeof self.channel === 'object',
        'expected options.channel to be channel object'
    );

    self.lastRun = NaN;

    self.banListPruner = new IntervalScan({
        name: 'ban-list-prune',
        timers: self.channel.timers,
        interval: options.pruneBanListPeriod || DEFAULT_PRUNE_BAN_LIST_PERIOD,
        each: function pruneEachBanItem(hostPortAndInstance, time) {
            var now = Date.now();
            if (now > self.banList[hostPortAndInstance]) {
                delete self.banList[hostPortAndInstance];
            }
        },
        getCollection: function getBanListToPrune() {
            return self.banList;
        }
    });

    self.banList = Object.create(null);
}

InstanceBanList.prototype.ban =
function ban(serviceName, instanceHostPort, timeToBan) {
    var self = this;
    // timeToBan is in seconds
    self.banList[serviceName + '~~' + instanceHostPort] = Date.now() + (timeToBan * 1000);
};

InstanceBanList.prototype.isBanned =
function isBanListed(serviceName, instanceHostPort) {
    var self = this;

    if (self.banList[serviceName + '~~' + instanceHostPort]) {
        return true;
    }

    return false;
};
