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

allocCluster.test('query rps counts', {
    size: 2
}, function t(cluster, assert) {
    var bob = cluster.remotes.bob;
    bob.clientChannel.request({
        serviceName: 'steve',
        timeout: 50
    }).send('echo', null, JSON.stringify('oh hi lol'), onForwarded);

    function onForwarded(err, res, arg2, arg3) {
        assert.ok(!err, 'should not fail');

        bob.clientChannel.waitForIdentified({host: cluster.hostPortList[0]}, onIdent0);
    }

    function onIdent0(err) {
        assert.ifError(err);

        bob.clientChannel.request({
            serviceName: 'autobahn',
            host: cluster.hostPortList[0],
            timeout: 50,
            headers: {as: 'json'}
        }).send('rps_counters_v1', null, null, onCountersResponse);
    }

    var rpsCounts0;
    var rpsCounts1;

    function onCountersResponse(err, res, arg2, arg3) {
        assert.ifError(err);

        var parsed = JSON.parse(arg3.toString());
        rpsCounts0 = parsed;

        bob.clientChannel.waitForIdentified({host: cluster.hostPortList[1]}, onIdent1);
    }

    function onIdent1(err) {
        assert.ifError(err);

        bob.clientChannel.request({
            serviceName: 'autobahn',
            host: cluster.hostPortList[1],
            timeout: 50,
            headers: {as: 'json'}
        }).send('rps_counters_v1', null, null, onCountersResponse2);
    }

    function onCountersResponse2(err, res, arg2, arg3) {
        assert.ifError(err);
        var parsed = JSON.parse(arg3.toString());
        rpsCounts1 = parsed;

        assert.ok(rpsCounts0['bob~~steve'] === 0 ||
            rpsCounts1['bob~~steve'] === 0);

        assert.end();
    }
});
