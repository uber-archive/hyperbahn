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

var test = require('tape');
var RPSCounters = require('../rps_counters');
var Timer = require('time-mock');
var allocCluster = require('./lib/test-cluster.js');
var parallel = require('run-parallel');

test('rps counters', function t1(assert) {
    var timer = Timer(0);
    var counters = new RPSCounters(timer);
    counters.bootstrap();

    counters.inc('rtapi', 'octane');
    assert.equals(counters.curr['rtapi~~octane'], 1);

    counters.inc('rtapi', 'octane');
    counters.inc('rtapi', 'octane');
    counters.inc('rtapi', 'octane');
    counters.inc('rtapi', 'octane');
    assert.equals(counters.curr['rtapi~~octane'], 5);

    timer.advance(10 * 1000);
    assert.equals(counters.curr['rtapi~~octane'], 0);

    counters.inc('rtapi', 'octane');
    counters.inc('rtapi', 'octane');
    counters.inc('rtapi', 'octane');
    counters.inc('rtapi', 'octane');
    assert.equals(counters.curr['rtapi~~octane'], 4);

    timer.advance(10 * 1000);
    assert.equals(counters.curr['rtapi~~octane'], 0);

    counters.inc('rtapi', 'abacus');
    counters.inc('rtapi', 'abacus');
    assert.equals(counters.curr['rtapi~~abacus'], 2);

    timer.advance(10 * 1000);
    assert.equals(counters.curr['rtapi~~octane'], 0);
    assert.equals(counters.curr['rtapi~~abacus'], 0);

    var counts = counters.getCounts();
    assert.equals(counts['rtapi~~abacus'], 2);
    assert.equals(counts['rtapi~~octane'], 0);

    assert.end();
});

allocCluster.test('forwarding small timeout concurrently', {
    size: 2,
    dummySize: 2,
    namedRemotes: ['mary']
}, function t(cluster, assert) {
    var steve = cluster.remotes.steve;
    var bob = cluster.remotes.bob;

    var mary = cluster.namedRemotes[0];

    cluster.checkExitPeers(assert, {
        serviceName: steve.serviceName,
        hostPort: steve.hostPort
    });

    steve.serverChannel.register('m', function m(req, res) {
        res.headers.as = 'raw';
        res.sendOk(null, 'oh hi');
    });

    parallel([
        send(bob.clientChannel),
        send(mary.clientChannel)
    ], function onResults(err2, results) {
        assert.ifError(err2);

        assert.equal(results[0].ok, true);
        assert.equal(results[1].ok, true);

        var rpsCounter0 = cluster.apps[0].clients.serviceProxy.rpsCounters;
        var rpsCounter1 = cluster.apps[1].clients.serviceProxy.rpsCounters;

        assert.ok(
            rpsCounter0.curr['mary~~steve'] === 1 ||
            rpsCounter1.curr['mary~~steve'] === 1);
        assert.ok(
            rpsCounter0.curr['bob~~steve'] === 1 ||
            rpsCounter1.curr['bob~~steve'] === 1);

        assert.end();
    });
});

function send(chan) {
    return function thunk(cb) {
        chan.request({
            serviceName: 'steve',
            timeout: 300
        }).send('m', null, null, cb);
    };
}
