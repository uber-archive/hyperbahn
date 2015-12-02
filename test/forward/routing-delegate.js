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

var allocCluster = require('../lib/test-cluster.js');

allocCluster.test('routing delegate', {
    size: 5
}, function t(cluster, assert) {
    var steve = cluster.remotes.steve;
    var bob = cluster.remotes.bob;

    cluster.checkExitPeers(assert, {
        serviceName: steve.serviceName,
        hostPort: steve.hostPort
    });

    var TChannelAsJSON = cluster.dummies[0].TChannelAsJSON;

    var steveTCollectorSubchannel = steve.channel.makeSubChannel({
        serviceName: 'tcollector'
    });

    var tchannelJSON = TChannelAsJSON({logger: cluster.logger});
    tchannelJSON.register(steveTCollectorSubchannel, 'echo', {}, handleEcho);

    var steveReceived = false;

    function handleEcho(opts, req, head, body, cb) {
        steveReceived = true;

        cb(null, {
            ok: true,
            head: null,
            body: body
        });
    }

    bob.clientChannel.request({
        serviceName: 'tcollector',
        headers: {
            rd: 'steve',
            as: 'json'
        }
    }).send('echo', null, JSON.stringify('oh hi lol'), onForwarded);

    function onForwarded(err, res, arg2, arg3) {
        if (err) {
            assert.ifError(err);
            return assert.end();
        }

        assert.equal(String(arg3), '"oh hi lol"');

        assert.ok(steveReceived, 'steve received request');

        assert.end();
    }
});
