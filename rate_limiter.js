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

/* eslint max-statements: [2, 40] */
var assert = require('assert');

var stat = require('./stat-tags.js');

var DEFAULT_SERVICE_RPS_LIMIT = 100;
var DEFAULT_TOTAL_RPS_LIMIT = 1000;
var DEFAULT_BUCKET_NUMBER = 20;

var DEFAULT_TOTAL_KILL_SWITCH_BUFFER = 200;
var DEFAULT_SERVICE_KILL_SWITCH_FACTOR = 2;
var MIN_SERVICE_KILL_SWITCH_FACTOR = 1;

function RateLimiterCounter(options) {
    if (!(this instanceof RateLimiterCounter)) {
        return new RateLimiterCounter(options);
    }

    var self = this;
    self.index = 0;
    self.rps = 0;
    self.numOfBuckets = options.numOfBuckets;
    self.buckets = [];

    // self.buckets is read/written in refresh,
    // where read is always after write on a bucket.
    self.buckets[0] = 0;
    self.rpsLimit = options.rpsLimit;
}

RateLimiterCounter.prototype.refresh =
function refresh() {
    var self = this;

    // update the sliding window
    var next = (self.index + 1) % self.numOfBuckets;
    if (self.buckets[next]) {
        // offset the bucket being moved out
        self.rps -= self.buckets[next];
    }

    assert(self.rps >= 0, 'rps should always be larger equal to 0');
    self.index = next;
    self.buckets[self.index] = 0;
};

RateLimiterCounter.prototype.increment =
function increment() {
    var self = this;
    self.buckets[self.index] += 1;
    self.rps += 1;
};

function RateLimiter(options) {
    if (!(this instanceof RateLimiter)) {
        return new RateLimiter(options);
    }
    var self = this;

    // stats
    self.channel = options.channel;
    assert(self.channel && !self.channel.topChannel, 'RateLimiter requires top channel');

    self.batchStats = options.batchStats;
    self.timers = self.channel.timers;

    self.numOfBuckets = options.numOfBuckets || DEFAULT_BUCKET_NUMBER;
    assert(self.numOfBuckets > 0 && self.numOfBuckets <= 1000, 'counter numOfBuckets should between (0 1000]');
    self.cycle = self.numOfBuckets;

    self.defaultTotalKillSwitchBuffer = options.defaultTotalKillSwitchBuffer || DEFAULT_TOTAL_KILL_SWITCH_BUFFER;
    self.serviceKillSwitchFactor = options.serviceKillSwitchFactor || DEFAULT_SERVICE_KILL_SWITCH_FACTOR;

    self.defaultServiceRpsLimit = options.defaultServiceRpsLimit || DEFAULT_SERVICE_RPS_LIMIT;
    self.defaultTotalRpsLimit = DEFAULT_TOTAL_RPS_LIMIT;
    self.totalRpsLimit = options.totalRpsLimit;
    if (typeof self.totalRpsLimit !== 'number') {
        self.totalRpsLimit = self.defaultTotalRpsLimit;
    }
    self.rpsLimitForServiceName = options.rpsLimitForServiceName || Object.create(null);
    self.exemptServices = options.exemptServices || [];
    self.serviceCounters = Object.create(null);
    self.edgeCounters = Object.create(null);
    self.ksCounters = Object.create(null);
    self.totalRequestCounter = RateLimiterCounter({
        numOfBuckets: self.numOfBuckets,
        rpsLimit: self.totalRpsLimit
    });
    self.totalKsCounter = RateLimiterCounter({
        numOfBuckets: self.numOfBuckets,
        rpsLimit: self.totalRpsLimit + self.defaultTotalKillSwitchBuffer
    });

    self.refreshDelay = 1000 / self.numOfBuckets;
    self.refresh();

    self.destroyed = false;
}

RateLimiter.prototype.type = 'tchannel.rate-limiting';

RateLimiter.prototype.refreshCounter =
function refreshCounter(counter, rpsStatsName, rpsLimitStatsName, createStatsTag, tagName) {
    var self = this;
    if (self.cycle === self.numOfBuckets) {
        var statsTag = createStatsTag(tagName);
        if (rpsStatsName && counter.rps) {
            self.batchStats.pushStat(
                rpsStatsName,
                'timing',
                counter.rps,
                statsTag
            );
        }

        if (rpsLimitStatsName) {
            self.batchStats.pushStat(
                rpsLimitStatsName,
                'gauge',
                counter.rpsLimit,
                statsTag
            );
        }
    }
    counter.refresh();
};

RateLimiter.prototype.refreshEachCounter =
function refreshEachCounter(counters, rpsStatsName, rpsLimitStatsName, createStatsTag, removeZeroRps) {
    var self = this;
    var serviceNames = Object.keys(counters);
    for (var i = 0; i < serviceNames.length; i++) {
        var counter = counters[serviceNames[i]];
        self.refreshCounter(counter,
            rpsStatsName,
            rpsLimitStatsName,
            createStatsTag,
            serviceNames[i]
        );

        if (removeZeroRps && counter.rps === 0) {
            delete counters[serviceNames[i]];
        }
    }
};

RateLimiter.prototype.refresh =
function refresh() {
    var self = this;

    self.refreshCounter(self.totalRequestCounter,
        'tchannel.rate-limiting.total-rps',
        'tchannel.rate-limiting.total-rps-limit',
        function createEmptyTag() {
            return new stat.RateLimiterEmptyTags();
        }
    );

    self.refreshCounter(self.totalKsCounter,
        'tchannel.rate-limiting.kill-switch.total-rps',
        null,
        function createEmptyTag() {
            return new stat.RateLimiterEmptyTags();
        }
    );

    self.refreshEachCounter(self.serviceCounters,
        'tchannel.rate-limiting.service-rps',
        'tchannel.rate-limiting.service-rps-limit',
        createServiceTag
    );

    self.refreshEachCounter(self.ksCounters,
        'tchannel.rate-limiting.kill-switch.service-rps',
        null,
        createServiceTag
    );

    self.refreshEachCounter(self.edgeCounters,
        null,
        null,
        createEdgeTag,
        true
    );

    self.cycle--;
    if (self.cycle <= 0) {
        self.cycle = self.numOfBuckets;
    }

    self.refreshTimer = self.timers.setTimeout(
        function refreshAgain() {
            self.refresh();
        },
        self.refreshDelay
    );

    function createServiceTag(serviceName) {
        return new stat.RateLimiterServiceTags(serviceName);
    }

    function createEdgeTag(serviceName) {
        return new stat.RateLimiterEdgeTags(serviceName);
    }
};

RateLimiter.prototype.removeServiceCounter =
function removeServiceCounter(serviceName) {
    var self = this;
    delete self.serviceCounters[serviceName];
};

RateLimiter.prototype.removeKillSwitchCounter =
function removeKillSwitchCounter(serviceName) {
    var self = this;
    delete self.ksCounters[serviceName];
};

RateLimiter.prototype.updateExemptServices =
function updateExemptServices(exemptServices) {
    var self = this;
    self.exemptServices = exemptServices;
};

RateLimiter.prototype.getRpsLimitForService =
function getRpsLimitForService(serviceName) {
    var self = this;
    var limit = self.rpsLimitForServiceName[serviceName];
    if (typeof limit !== 'number') {
        limit = self.defaultServiceRpsLimit;
    }

    return limit;
};

RateLimiter.prototype.updateRpsLimitForAllServices =
function updateRpsLimitForAllServices(rpsLimitForServiceName) {
    var self = this;

    var name;
    var limit;

    // for removed or updated services
    var keys = Object.keys(self.rpsLimitForServiceName);
    for (var i = 0; i < keys.length; i++) {
        name = keys[i];
        limit = rpsLimitForServiceName[name];
        if (typeof limit !== 'number') {
            limit = 'default';
            delete self.rpsLimitForServiceName[name];
        }
        self.updateServiceLimit(name, limit);
    }

    // for new services
    keys = Object.keys(rpsLimitForServiceName);
    for (i = 0; i < keys.length; i++) {
        name = keys[i];
        limit = self.rpsLimitForServiceName[name];
        if (typeof limit !== 'number') {
            limit = rpsLimitForServiceName[name];
            self.updateServiceLimit(name, limit);
        }
    }
};

RateLimiter.prototype.updateServiceLimit =
function updateServiceLimit(serviceName, limit) {
    var self = this;

    if (limit === 'default') {
        delete self.rpsLimitForServiceName[serviceName];
        limit = self.defaultServiceRpsLimit;
    } else {
        self.rpsLimitForServiceName[serviceName] = limit;
    }

    // update counter
    var counter = self.serviceCounters[serviceName];
    if (counter) {
        counter.rpsLimit = limit;
    }

    // update ks counter
    counter = self.ksCounters[serviceName];
    if (counter) {
        counter.rpsLimit = self.killSwitchLimitForService(serviceName);
    }
};

RateLimiter.prototype.updateDefaultServiceRpsLimit =
function updateDefaultServiceRpsLimit(limit) {
    var self = this;

    if (limit === 0) {
        self.defaultServiceRpsLimit = DEFAULT_SERVICE_RPS_LIMIT;
    } else {
        self.defaultServiceRpsLimit = limit;
    }
};

RateLimiter.prototype.updateTotalLimit =
function updateTotalLimit(limit) {
    var self = this;
    self.totalRpsLimit = limit;
    self.totalRequestCounter.rpsLimit = limit;

    // allow total RPS limit to kick in first
    self.totalKsCounter.rpsLimit = self.totalRpsLimit + self.defaultTotalKillSwitchBuffer;
};

RateLimiter.prototype.createServiceCounter =
function createServiceCounter(serviceName) {
    var self = this;
    var counter;

    assert(serviceName, 'createServiceCounter requires the serviceName');

    if (self.exemptServices.indexOf(serviceName) !== -1) {
        return null;
    }

    // if this is an existing service counter
    counter = self.serviceCounters[serviceName];
    // creating a new service counter
    if (!counter) {
        var limit = self.rpsLimitForServiceName[serviceName];
        if (typeof limit !== 'number') {
            limit = self.defaultServiceRpsLimit;
        }
        counter = RateLimiterCounter({
            numOfBuckets: self.numOfBuckets,
            rpsLimit: limit
        });
        self.serviceCounters[serviceName] = counter;
    }

    return counter;
};

RateLimiter.prototype.killSwitchLimitForService =
function killSwitchLimitForService(serviceName) {
    var self = this;
    assert(self.serviceCounters[serviceName], 'Cannot find service counter for ' + serviceName);
    return self.serviceCounters[serviceName].rpsLimit * self.serviceKillSwitchFactor;
};

RateLimiter.prototype.createKillSwitchServiceCounter =
function createKillSwitchServiceCounter(serviceName) {
    var self = this;
    var counter;

    assert(serviceName, 'createKillSwitchServiceCounter requires the serviceName');

    if (self.exemptServices.indexOf(serviceName) !== -1) {
        return null;
    }

    counter = self.ksCounters[serviceName];
    if (!counter) {
        counter = RateLimiterCounter({
            numOfBuckets: self.numOfBuckets,
            rpsLimit: self.killSwitchLimitForService(serviceName)
        });
        self.ksCounters[serviceName] = counter;
    }
    return counter;
};

RateLimiter.prototype.incrementServiceCounter =
function incrementServiceCounter(serviceName) {
    var self = this;
    var counter = self.createServiceCounter(serviceName);

    if (counter) {
        // increment the service counter
        counter.increment();
    }
};

RateLimiter.prototype.incrementEdgeCounter =
function incrementEdgeCounter(name) {
    var self = this;
    var counter = self.edgeCounters[name];
    if (!counter) {
        counter = RateLimiterCounter({
            numOfBuckets: self.numOfBuckets,
            rpsLimit: 0
        });
        self.edgeCounters[name] = counter;
    }

    counter.increment();
};

RateLimiter.prototype.incrementKillSwitchServiceCounter =
function incrementKillSwitchServiceCounter(name) {
    var self = this;
    var counter = self.ksCounters[name];
    if (!counter) {
        counter = self.createKillSwitchServiceCounter(name);
    }

    if (counter) {
        counter.increment();
    }
};

RateLimiter.prototype.incrementTotalCounter =
function incrementTotalCounter(serviceName) {
    var self = this;
    if (!serviceName || self.exemptServices.indexOf(serviceName) === -1) {
        self.totalRequestCounter.increment();
    }
};

RateLimiter.prototype.incrementKillSwitchTotalCounter =
function incrementKillSwitchTotalCounter(serviceName) {
    var self = this;
    if (!serviceName || self.exemptServices.indexOf(serviceName) === -1) {
        self.totalKsCounter.increment();
    }
};

RateLimiter.prototype.shouldRateLimitService =
function shouldRateLimitService(serviceName) {
    var self = this;
    if (self.exemptServices.indexOf(serviceName) !== -1) {
        return false;
    }
    var counter = self.serviceCounters[serviceName];
    assert(counter, 'cannot find counter for ' + serviceName);
    var result = counter.rpsLimit > 0 && counter.rps > counter.rpsLimit;
    if (result) {
        self.batchStats.pushStat(
            'tchannel.rate-limiting.service-busy',
            'counter',
            1,
            new stat.RateLimiterServiceTags(serviceName)
        );
    }
    return result;
};

RateLimiter.prototype.shouldKillSwitchService =
function shouldKillSwitchService(serviceName) {
    var self = this;
    if (self.exemptServices.indexOf(serviceName) !== -1) {
        return false;
    }
    var counter = self.ksCounters[serviceName];
    assert(counter, 'cannot find kill-switch counter for ' + serviceName);
    var result = counter.rpsLimit > 0 && counter.rps > counter.rpsLimit;
    if (result) {
        self.batchStats.pushStat(
            'tchannel.rate-limiting.service-kill-switched',
            'counter',
            1,
            new stat.RateLimiterServiceTags(serviceName)
        );
    }
    return result;
};

RateLimiter.prototype.shouldRateLimitTotalRequest =
function shouldRateLimitTotalRequest(serviceName) {
    var self = this;
    var result;
    if (!serviceName || self.exemptServices.indexOf(serviceName) === -1) {
        result =
            self.totalRequestCounter.rpsLimit > 0 &&
            self.totalRequestCounter.rps > self.totalRequestCounter.rpsLimit;
    } else {
        result = false;
    }

    if (result) {
        self.batchStats.pushStat(
            'tchannel.rate-limiting.total-busy',
            'counter',
            1,
            new stat.RateLimiterServiceTags(serviceName)
        );
    }

    return result;
};

RateLimiter.prototype.shouldKillSwitchTotalRequest =
function shouldKillSwitchTotalRequest(serviceName) {
    var self = this;
    var result;
    if (!serviceName || self.exemptServices.indexOf(serviceName) === -1) {
        result =
            self.totalKsCounter.rpsLimit > 0 &&
            self.totalKsCounter.rps > self.totalKsCounter.rpsLimit;
    } else {
        result = false;
    }

    if (result) {
        self.batchStats.pushStat(
            'tchannel.rate-limiting.total-kill-switched',
            'counter',
            1,
            new stat.RateLimiterServiceTags(serviceName)
        );
    }

    return result;
};

RateLimiter.prototype.setServiceKillSwitchFactor = function setServiceKillSwitchFactor(factor) {
    this.serviceKillSwitchFactor = Math.max(MIN_SERVICE_KILL_SWITCH_FACTOR,
        factor || DEFAULT_SERVICE_KILL_SWITCH_FACTOR);
};

RateLimiter.prototype.destroy =
function destroy() {
    var self = this;
    self.destroyed = true;
    self.timers.clearTimeout(self.refreshTimer);
};

module.exports = RateLimiter;
