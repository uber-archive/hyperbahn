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

var CollapsedAssert = require('../lib/collapsed-assert.js');
var allocCluster = require('../lib/test-cluster.js');

allocCluster.test('requesting rate limited to cluster', {
    size: 5,
    remoteConfig: {
        'rateLimiting.enabled': true,
        'rateLimiting.totalRpsLimit': 10,
        'rateLimiting.exemptServices': [
            'hyperbahn',
            'autobahn',
            'ringpop',
            'tcollector'
        ]
    }
}, function t(cluster, assert) {
    cluster.logger.whitelist(
        'info', 'hyperbahn node is rate-limited by the total rps limit'
    );
    cluster.logger.whitelist(
        'warn', 'forwarding error frame'
    );

    var steve = cluster.remotes.steve;
    var bob = cluster.remotes.bob;

    var stats = [];

    for (var i = 0; i < cluster.apps.length; i++) {
        cluster.apps[i].tchannel.statEvent.on(onStat);
    }

    function onStat(stat) {
        stats.push(stat);
    }

    cluster.checkExitPeers(assert, {
        serviceName: steve.serviceName,
        hostPort: steve.hostPort
    });

    var results = [];
    var body = JSON.stringify('oh hi lol');

    var counter = 100;
    for (i = 0; i < counter; i++) {
        bob.clientChannel.request({
            // host: cluster.apps[0].hostPort,
            timeout: 1000,
            serviceName: steve.serviceName,
            retryFlags: {
                never: true
            }
        }).send('echo', null, body, onResponse);
    }

    function onResponse(err, value) {
        results.push(new Result(err, value));

        if (--counter === 0) {
            onForwarded();
        }
    }

    function onForwarded() {
        var logs = cluster.logger.items();
        assert.ok(logs.length > 50,
            'expected >50 logs about rate limiting'
        );

        var errors = [];
        for (i = 0; i < results.length; i++) {
            if (results[i].err) {
                errors.push(results[i].err);
            }
        }

        assert.ok(errors.length > 50,
            'expected >50 errors');

        var cassert = CollapsedAssert();
        for (i = 0; i < errors.length; i++) {
            cassert.equal(errors[i].codeName, 'Busy');
            cassert.equal(errors[i].type, 'tchannel.busy');
        }
        cassert.report(assert, 'expected all errors to be busy');

        var allStats = statsByType(stats);
        var latencies = allStats['tchannel.inbound.calls.latency'];

        var echoLatencies = [];
        for (i = 0; i < latencies.length; i++) {
            if (latencies[i].tags.endpoint === 'echo') {
                echoLatencies.push(latencies[i]);
            }
        }

        assert.ok(echoLatencies.length >= errors.length,
            'expected more latencies then errors');
        cassert = CollapsedAssert();
        for (i = 0; i < echoLatencies.length; i++) {
            cassert.equal(echoLatencies[i].tags.endpoint, 'echo');
        }
        cassert.report(assert, 'expected all latencies to be echo()');

        assert.end();
    }
});

allocCluster.test('requesting rate limited to one host', {
    size: 5,
    remoteConfig: {
        'rateLimiting.enabled': true,
        'rateLimiting.totalRpsLimit': 10,
        'rateLimiting.exemptServices': [
            'hyperbahn',
            'autobahn',
            'ringpop',
            'tcollector'
        ]
    }
}, function t(cluster, assert) {
    cluster.logger.whitelist(
        'info', 'hyperbahn node is rate-limited by the total rps limit'
    );

    var steve = cluster.remotes.steve;
    var bob = cluster.remotes.bob;

    var stats = [];
    cluster.apps[0].tchannel.statEvent.on(onStat);
    function onStat(stat) {
        stats.push(stat);
    }

    cluster.checkExitPeers(assert, {
        serviceName: steve.serviceName,
        hostPort: steve.hostPort
    });

    var results = [];
    var counter = 100;
    var body = JSON.stringify('oh hi lol');

    bob.clientChannel.waitForIdentified({
        host: cluster.apps[0].hostPort
    }, onIdentified);

    function onIdentified(err) {
        assert.ifError(err);

        for (var i = 0; i < counter; i++) {
            bob.clientChannel.request({
                host: cluster.apps[0].hostPort,
                timeout: 1000,
                serviceName: steve.serviceName
            }).send('echo', null, body, onResponse);
        }
    }

    function onResponse(err, value) {
        results.push(new Result(err, value));

        if (--counter === 0) {
            onForwarded();
        }
    }

    function onForwarded() {
        var logs = cluster.logger.items();
        assert.ok(logs.length >= 89,
            'expected >89 logs about rate limiting'
        );

        var errors = [];
        for (var i = 0; i < results.length; i++) {
            if (results[i].err) {
                errors.push(results[i].err);
            }
        }

        assert.equal(errors.length, 89,
            'expected 89 errors');

        var cassert = CollapsedAssert();
        for (i = 0; i < errors.length; i++) {
            cassert.equal(errors[i].codeName, 'Busy');
            cassert.equal(errors[i].type, 'tchannel.busy');
        }
        cassert.report(assert, 'expected all errors to be busy');

        var allStats = statsByType(stats);
        var latencies = allStats['tchannel.inbound.calls.latency'];

        var echoLatencies = [];
        for (i = 0; i < latencies.length; i++) {
            if (latencies[i].tags.endpoint === 'echo') {
                echoLatencies.push(latencies[i]);
            }
        }

        assert.equal(echoLatencies.length, 100);
        cassert = CollapsedAssert();
        for (i = 0; i < echoLatencies.length; i++) {
            cassert.equal(echoLatencies[i].tags.endpoint, 'echo');
        }
        cassert.report(assert, 'expected all latencies to be echo()');

        assert.end();
    }
});

function statsByType(stats) {
    var byType = {};

    for (var i = 0; i < stats.length; i++) {
        var stat = stats[i];
        if (!byType[stat.name]) {
            byType[stat.name] = [];
        }

        byType[stat.name].push(stat);
    }

    return byType;
}

function Result(err, value) {
    this.err = err;
    this.value = value;
}
