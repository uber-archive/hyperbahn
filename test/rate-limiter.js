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
var series = require('run-series');

var allocCluster = require('./lib/test-cluster.js');

function increment(rateLimiter, steve, bob, done) {
    if (steve) {
        rateLimiter.incrementTotalCounter('steve');
        rateLimiter.incrementServiceCounter('steve');
        rateLimiter.incrementKillSwitchServiceCounter('steve');
        rateLimiter.incrementKillSwitchTotalCounter('steve');
    }

    if (bob) {
        rateLimiter.incrementTotalCounter('bob');
        rateLimiter.incrementServiceCounter('bob');
        rateLimiter.incrementKillSwitchServiceCounter('bob');
        rateLimiter.incrementKillSwitchTotalCounter('bob');
    }

    if (done) {
        done();
    }
}

function wait(done) {
    timers.setTimeout(done, 500);
}

allocCluster.test('rps counter works', {
    size: 1,
    remoteConfig: {
        'rateLimiting.rateLimiterBuckets': 2,
        'rateLimiting.defaultTotalKillSwitchBuffer': 5
    },
    statsdSize: 100
}, function t(cluster, assert) {
    var app = cluster.apps[0];
    var rateLimiter = app.clients.serviceProxy.rateLimiter;
    var statsd = app.clients.statsd;

    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve');

    assert.equals(rateLimiter.totalRequestCounter.rps, 5, 'total request');
    assert.equals(rateLimiter.totalKsCounter.rps, 5, 'total request - kill switch');
    assert.equals(rateLimiter.serviceCounters.steve.rps, 3, 'request for steve');
    assert.equals(rateLimiter.ksCounters.steve.rps, 3, 'request for steve - kill switch');
    assert.equals(rateLimiter.serviceCounters.bob.rps, 2, 'request for bob');
    assert.equals(rateLimiter.ksCounters.bob.rps, 2, 'request for bob - kill switch');

    app.clients.batchStats.flushStats();

    var elems = statsd._buffer._elements;

    var rateLimitStats = elems.filter(function isRateLimit(x) {
        return x.name.indexOf('rate-limiting') > -1;
    });

    assert.deepEqual(rateLimitStats, [{
        type: 'g',
        name: 'tchannel.rate-limiting.total-rps-limit',
        value: 1000,
        delta: null,
        time: null
    }], 'stats keys/values as expected');

    assert.end();
});

allocCluster.test('rps counter works in 1.5 seconds', {
    size: 1,
    remoteConfig: {
        'rateLimiting.rateLimiterBuckets': 2,
        'rateLimiting.defaultTotalKillSwitchBuffer': 5
    },
    statsdSize: 100,
    whitelist: [
        ['warn', 'no usable nodes at protocol period']
    ]
}, function t(cluster, assert) {
    var app = cluster.apps[0];
    var rateLimiter = app.clients.serviceProxy.rateLimiter;
    var statsd = app.clients.statsd;

    series([
        increment.bind(null, rateLimiter, 'steve', 'bob'),
        increment.bind(null, rateLimiter, 'steve', 'bob'),
        wait,
        increment.bind(null, rateLimiter, 'steve', null),
        function check1(done) {
            assert.equals(rateLimiter.totalRequestCounter.rps, 5, 'check1: total request');
            assert.equals(rateLimiter.totalKsCounter.rps, 5, 'check1: total request - kill switch');
            assert.equals(rateLimiter.serviceCounters.steve.rps, 3, 'check1: request for steve');
            assert.equals(rateLimiter.ksCounters.steve.rps, 3, 'check1: request for steve - kill switch');
            assert.equals(rateLimiter.serviceCounters.bob.rps, 2, 'check1: request for bob');
            assert.equals(rateLimiter.ksCounters.bob.rps, 2, 'check1: request for bob - kill switch');
            done();
        },
        wait,
        increment.bind(null, rateLimiter, 'steve', 'bob'),
        function check2(done) {
            assert.equals(rateLimiter.totalRequestCounter.rps, 3, 'check2: total request');
            assert.equals(rateLimiter.totalKsCounter.rps, 3, 'check2: total request - kill switch');
            assert.equals(rateLimiter.serviceCounters.steve.rps, 2, 'check2: request for steve');
            assert.equals(rateLimiter.ksCounters.steve.rps, 2, 'check2: request for steve - kill switch');
            assert.equals(rateLimiter.serviceCounters.bob.rps, 1, 'check2: request for bob');
            assert.equals(rateLimiter.ksCounters.bob.rps, 1, 'check2: request for bob - kill switch');
            done();
        }
    ], function done() {

        // Force flush of second stats with two refreshes
        timers.clearTimeout(rateLimiter.refreshTimer);
        rateLimiter.refresh();
        timers.clearTimeout(rateLimiter.refreshTimer);
        rateLimiter.refresh();
        app.clients.batchStats.flushStats();

        var elems = statsd._buffer._elements;

        var rateLimitStats = elems.filter(function isRateLimit(x) {
            return x.type !== 'g' && x.name.indexOf('rate-limiting') > -1;
        });

        var expected = [{
            type: 'c',
            name: 'tchannel.rate-limiting.total-rps',
            value: null,
            delta: 5,
            time: null
        }, {
            type: 'c',
            name: 'tchannel.rate-limiting.kill-switch.total-rps',
            value: null,
            delta: 5,
            time: null
        }, {
            type: 'c',
            name: 'tchannel.rate-limiting.service-rps.steve',
            value: null,
            delta: 3,
            time: null
        }, {
            type: 'c',
            name: 'tchannel.rate-limiting.service-rps.bob',
            value: null,
            delta: 2,
            time: null
        }, {
            type: 'c',
            name: 'tchannel.rate-limiting.kill-switch.service-rps.steve',
            value: null,
            delta: 3,
            time: null
        }, {
            type: 'c',
            name: 'tchannel.rate-limiting.kill-switch.service-rps.bob',
            value: null,
            delta: 2,
            time: null
        }, {
            type: 'c',
            name: 'tchannel.rate-limiting.total-rps',
            value: null,
            delta: 2,
            time: null
        }, {
            type: 'c',
            name: 'tchannel.rate-limiting.kill-switch.total-rps',
            value: null,
            delta: 2,
            time: null
        }, {
            type: 'c',
            name: 'tchannel.rate-limiting.service-rps.steve',
            value: null,
            delta: 1,
            time: null
        }, {
            type: 'c',
            name: 'tchannel.rate-limiting.service-rps.bob',
            value: null,
            delta: 1,
            time: null
        }, {
            type: 'c',
            name: 'tchannel.rate-limiting.kill-switch.service-rps.steve',
            value: null,
            delta: 1,
            time: null
        }, {
            type: 'c',
            name: 'tchannel.rate-limiting.kill-switch.service-rps.bob',
            value: null,
            delta: 1,
            time: null
        }];

        assert.deepEqual(rateLimitStats, expected,
            'stats keys/values as expected');

        assert.end();
    });
});

allocCluster.test('remove counter works', {
    size: 1,
    remoteConfig: {
        'rateLimiting.rateLimiterBuckets': 2,
        'rateLimiting.defaultTotalKillSwitchBuffer': 5
    },
    statsdSize: 100
}, function t(cluster, assert) {
    var app = cluster.apps[0];
    var rateLimiter = app.clients.serviceProxy.rateLimiter;

    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve');

    rateLimiter.removeServiceCounter('steve');
    rateLimiter.removeKillSwitchCounter('steve');

    assert.equals(rateLimiter.totalRequestCounter.rps, 5, 'total request');
    assert.equals(rateLimiter.totalKsCounter.rps, 5, 'total request - kill switch');
    assert.ok(!rateLimiter.serviceCounters.steve, 'steve should be removed');
    assert.ok(!rateLimiter.ksCounters.steve, 'steve should be removed - kill switch');
    assert.equals(rateLimiter.serviceCounters.bob.rps, 2, 'request for bob');

    assert.end();
});

allocCluster.test('rate limit works', {
    size: 1,
    remoteConfig: {
        'rateLimiting.rateLimiterBuckets': 2,
        'rateLimiting.defaultTotalKillSwitchBuffer': 3,
        'rateLimiting.totalRpsLimit': 3,
        'rateLimiting.rpsLimitForServiceName': {
            steve: 2
        }
    },
    statsdSize: 100
}, function t(cluster, assert) {
    var app = cluster.apps[0];
    var rateLimiter = app.clients.serviceProxy.rateLimiter;

    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve');
    increment(rateLimiter, 'steve');
    increment(rateLimiter, 'steve');

    assert.equals(rateLimiter.ksCounters.steve.rpsLimit, 4, 'kill swith limit for steve');
    assert.equals(rateLimiter.totalKsCounter.rpsLimit, 6, 'total kill swith limit');

    assert.equals(rateLimiter.totalRequestCounter.rps, 7, 'total request');
    assert.equals(rateLimiter.totalKsCounter.rps, 7, 'total request - kill switch');
    assert.equals(rateLimiter.serviceCounters.steve.rps, 5, 'request for steve');
    assert.equals(rateLimiter.ksCounters.steve.rps, 5, 'request for steve - kill switch');
    assert.equals(rateLimiter.serviceCounters.bob.rps, 2, 'request for bob');
    assert.equals(rateLimiter.ksCounters.bob.rps, 2, 'request for bob - kill switch');

    assert.ok(rateLimiter.shouldRateLimitTotalRequest(), 'should rate limit total request');
    assert.ok(rateLimiter.shouldKillSwitchTotalRequest(), 'should kill switch total request');
    assert.ok(rateLimiter.shouldRateLimitService('steve'), 'should rate limit steve');
    assert.ok(rateLimiter.shouldKillSwitchService('steve'), 'should kill switch steve');
    assert.ok(!rateLimiter.shouldRateLimitService('bob'), 'should not rate limit bob');
    assert.ok(!rateLimiter.shouldKillSwitchService('bob'), 'should not kill switch bob');

    assert.end();
});

allocCluster.test('rate exempt service works 1', {
    size: 1,
    remoteConfig: {
        'rateLimiting.rateLimiterBuckets': 2,
        'rateLimiting.totalRpsLimit': 2,
        'rateLimiting.defaultTotalKillSwitchBuffer': 3,
        'rateLimiting.exemptServices': ['steve']
    },
    statsdSize: 100
}, function t(cluster, assert) {
    var app = cluster.apps[0];
    var rateLimiter = app.clients.serviceProxy.rateLimiter;

    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve', 'bob');

    assert.ok(!rateLimiter.shouldRateLimitTotalRequest('steve'), 'should not rate limit steve');
    assert.ok(!rateLimiter.shouldKillSwitchTotalRequest('steve'), 'should not kill switch steve');
    assert.ok(!rateLimiter.shouldRateLimitService('steve'), 'should not rate limit steve');
    assert.ok(!rateLimiter.shouldKillSwitchService('steve'), 'should not kill switch steve');
    assert.ok(rateLimiter.shouldRateLimitTotalRequest('bob'), 'should rate limit bob');
    assert.ok(rateLimiter.shouldKillSwitchTotalRequest('bob'), 'should kill switch bob');

    assert.end();
});

allocCluster.test('rate exempt service works 2', {
    size: 1,
    remoteConfig: {
        'rateLimiting.rateLimiterBuckets': 2,
        'rateLimiting.totalRpsLimit': 2,
        'rateLimiting.defaultTotalKillSwitchBuffer': 1,
        'rateLimiting.rpsLimitForServiceName': {
            steve: 1,
            bob: 1
        }
    },
    statsdSize: 100
}, function t(cluster, assert) {
    var app = cluster.apps[0];
    var rateLimiter = app.clients.serviceProxy.rateLimiter;

    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve', 'bob');
    increment(rateLimiter, 'steve', 'bob');

    assert.equals(rateLimiter.ksCounters.steve.rps, 3, 'steve\'s kill switch rps as expected');
    assert.equals(rateLimiter.ksCounters.steve.rpsLimit, 2, 'steve\'s kill switch rpsLimit as expected');

    assert.ok(rateLimiter.shouldRateLimitTotalRequest(), 'should rate limit total');
    assert.ok(rateLimiter.shouldKillSwitchTotalRequest(), 'should kill switch total');
    assert.ok(rateLimiter.shouldKillSwitchService('steve'), 'should kill switch steve');
    assert.ok(rateLimiter.shouldRateLimitService('steve'), 'should rate limit steve');
    assert.ok(rateLimiter.shouldRateLimitService('bob'), 'should rate limit bob');
    assert.ok(rateLimiter.shouldKillSwitchService('bob'), 'should kill switch bob');

    rateLimiter.updateTotalLimit(10);
    rateLimiter.updateServiceLimit('steve', 10);

    assert.equals(rateLimiter.ksCounters.steve.rps, 3, 'steve\'s rps as expected after change of limit');
    assert.equals(rateLimiter.ksCounters.steve.rpsLimit, 20, 'steve\'s rpsLimit as expected after change of limit');
    assert.equals(rateLimiter.totalKsCounter.rpsLimit, 11, 'total rpsLimit as expected after change of limit');

    assert.ok(!rateLimiter.shouldRateLimitTotalRequest(), 'should not rate limit total');
    assert.ok(!rateLimiter.shouldKillSwitchTotalRequest(), 'should not kill switch total');
    assert.ok(!rateLimiter.shouldRateLimitService('steve'), 'should not rate limit steve');
    assert.ok(rateLimiter.shouldRateLimitService('bob'), 'should rate limit bob');

    assert.end();
});
