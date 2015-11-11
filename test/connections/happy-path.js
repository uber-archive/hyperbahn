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

var collectParallel = require('collect-parallel/array');
var allocCluster = require('../lib/test-cluster.js');

allocCluster.test('find connections for service', {
    size: 10,
    dummySize: 5
}, function t(cluster, assert) {
    var apps = cluster.apps;
    var dummies = cluster.dummies;
    var entryNode = apps[0];

    setup();

    function setup() {
        assert.comment('-- setup');

        collectParallel(
            dummies,
            function registerEach(dummy, i, done) {
                cluster.sendRegister(dummy, {
                    serviceName: 'Dummy'
                }, done);
            },
            function finishRegister(_, results) {
                for (var i = 0; i < results.length; i++) {
                    var res = results[i];
                    assert.ifError(res.err, 'no unexpected error from register ' + i);
                }
                runTest();
            }
        );
    }

    function runTest() {
        assert.comment('-- runTest');

        cluster.checkExitPeers(assert, {
            serviceName: 'Dummy',
            hostPort: dummies[0].hostPort
        });

        entryNode.client.getConnections({
            serviceName: 'Dummy'
        }, onResults);
    }

    function onResults(err, resp) {
        assert.comment('-- onResults');

        if (err) {
            finish(err);
            return;
        }

        var exitHosts = entryNode.hostsFor('Dummy');

        var body = resp.body;
        assert.deepEqual(
            exitHosts.sort(),
            Object.keys(body).sort(),
            'got expected exit hosts back');

        Object.keys(body).forEach(function checkInstances(key) {
            if (body[key].err) {
                assert.ifError(body[key].err);
                return;
            }

            var exitInstances = body[key].instances;

            Object.keys(exitInstances).forEach(function checkInst(key2) {
                var exitInstance = exitInstances[key2];

                var isConnected = exitInstance.connected.out ||
                    exitInstance.connected.in;

                assert.equal(isConnected, true,
                    'exit instance is connected');
            });
        });

        finish(null);
    }

    function finish(err) {
        assert.comment('-- finish');
        assert.ifError(err);

        assert.end();
    }
});
