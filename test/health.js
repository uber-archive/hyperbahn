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

var UDPServer = require('uber-statsd-client/test/lib/udp-server.js');
var setTimeout = require('timers').setTimeout;

var allocCluster = require('./lib/test-cluster.js');

allocCluster.test('tchannel health', {
    size: 1,
    dummySize: 0,
    namedRemotes: []
}, function t(cluster, assert) {
    var app = cluster.apps[0];

    app.client.sendHealth(function onResponse(err, resp) {
        assert.ifError(err);

        assert.equal(resp.body, 'hello from autobahn\n');

        assert.end();
    });
});

allocCluster.test('tchannel health (stats)', {
    size: 1,
    dummySize: 0,
    namedRemotes: [],
    noStats: true,
    seedConfig: {
        'clients.uber-statsd-client': {
            'host': '127.0.0.1',
            'port': 4744
        }
    }
}, function t(cluster, assert) {
    var app = cluster.apps[0];

    var messages = [];
    var server = UDPServer({
        host: '127.0.0.1',
        port: 4744
    }, onBound);

    function onBound() {
        server.on('message', onMessage);

        app.client.sendHealth(onResponse);
    }

    function onResponse(err, resp) {
        assert.ifError(err);

        assert.equal(resp.body, 'hello from autobahn\n');

        setTimeout(function flush() {
            app.clients.batchStats.flushStats();
            setTimeout(finish, 500);
        }, 500);
    }

    function finish() {
        var latencyMsgs = messages.filter(function x(m) {
            return m.indexOf('inbound.calls.latency.test-client') > -1;
        });

        var perWorker = latencyMsgs[0];
        var allWorker = latencyMsgs[1];

        assert.ok(perWorker.indexOf('autobahn.per-worker') === 0,
            'expected per-worker stat');
        assert.ok(allWorker.indexOf('autobahn.all-workers') === 0,
            'expected all-workers stat');

        server.close();
        assert.end();
    }

    function onMessage(msg) {
        var msgs = msg.toString().split('\n');
        for (var i = 0; i < msgs.length; i++) {
            messages.push(msgs[i]);
        }
    }
});

allocCluster.test('tchannel thrift health', {
    size: 1,
    dummySize: 0,
    namedRemotes: []
}, function t(cluster, assert) {
    var app = cluster.apps[0];

    app.client.sendHealthThrift(function onResponse(err, resp) {
        if (err) {
            assert.end(err);
        }

        assert.ok(resp.ok, 'response should be ok\n');
        assert.ok(resp.body.ok, 'response body should be ok\n');
        assert.equal(resp.body.message, 'hello from hyperbahn\n');

        assert.end();
    });
});
