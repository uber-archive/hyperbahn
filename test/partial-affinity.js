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

var allocCluster = require('./lib/test-cluster.js');
var parallel = require('run-parallel');

// TODO Dynamic kValue cases
// TODO Dynamic relay pool cases
// TODO Dynamic worker pool cases
// Static cases:

allocCluster.test('degenerate case for partial affinity', {
    size: 1,
    kValue: 1,
    namedRemotes: ['alice'],
    whitelist: [
        ['info', 'Refreshing service peer affinity']
    ],
    remoteConfig: {
        'partialAffinity.enabled': true
    },
    seedConfig: {
        'hyperbahn.partialAffinity': {
            minPeersPerRelay: 1,
            minPeersPerWorker: 1
        }
    }
}, function t(cluster, assert) {
    runScenario(cluster, assert, onCompletion);
    function onCompletion(err) {
        assert.end(err);
    }
});

allocCluster.test('few relays, many workers', {
    size: 1,
    kValue: 1,
    whitelist: [
        ['info', 'Refreshing service peer affinity']
    ],
    namedRemotes: ['alice', 'alice', 'alice', 'alice', 'alice'],
    remoteConfig: {
        'partialAffinity.enabled': true
    },
    seedConfig: {
        'hyperbahn.partialAffinity': {
            minPeersPerRelay: 1,
            minPeersPerWorker: 1
        }
    }
}, function t(cluster, assert) {
    runScenario(cluster, assert, onCompletion);
    function onCompletion(err) {
        assert.end(err);
    }
});

allocCluster.test('many relays, few workers', {
    size: 20,
    kValue: 20,
    namedRemotes: ['alice'],
    whitelist: [
        ['info', 'Refreshing service peer affinity']
    ],
    remoteConfig: {
        'partialAffinity.enabled': true
    },
    seedConfig: {
        'hyperbahn.partialAffinity': {
            minPeersPerRelay: 1,
            minPeersPerWorker: 1
        }
    }
}, function t(cluster, assert) {
    runScenario(cluster, assert, onCompletion);
    function onCompletion(err) {
        assert.end(err);
    }
});

allocCluster.test('nominal parameters', {
    size: 20,
    kValue: 5,
    whitelist: [
        ['info', 'Refreshing service peer affinity']
    ],
    namedRemotes: ['alice', 'alice', 'alice', 'alice'],
    remoteConfig: {
        'partialAffinity.enabled': true
    },
    seedConfig: {}
}, function t(cluster, assert) {
    runScenario(cluster, assert, onCompletion);
    function onCompletion(err) {
        assert.end(err);
    }
});

function setupRemotes(cluster) {
    cluster.namedRemotes.forEach(function eachRemote(alice) {
        alice.serverChannel.register('ping',
            function respond(req, res, head, body) {
                res.headers.as = 'raw';
                res.sendOk('', '');
            });
    });
}

function runScenario(cluster, assert, callback) {
    setupRemotes(cluster);
    sendRequests(cluster, 20, afterBarrage);
    function afterBarrage(err) {
        if (err) {
            return callback(err);
        }
        assert.ok(true, 'scenario completes');
        return callback(null);
    }
}

function sendRequests(cluster, count, callback) {
    var tasks = [];
    for (var i = 0; i < count; i++) {
        // 0.5 is the error rate threshold. There is some variance.
        // Test seems to pass with a success rate of 0.4, flipping the
        // circuit breaker.
        tasks.push(sendRequest.bind(null, cluster));
    }
    parallel(tasks, callback);
}

function sendRequest(cluster, onResponse) {
    var request = cluster.remotes.steve.clientChannel.request({
        serviceName: 'alice',
        timeout: 1000,
        hasNoParent: true
    });
    request.send('ping', '', '', onResponse);
}
