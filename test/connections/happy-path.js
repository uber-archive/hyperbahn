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

var process = require('process');
var collectParallel = require('collect-parallel/array');
var allocCluster = require('../lib/test-cluster.js');
var CollapsedAssert = require('../lib/collapsed-assert.js');

var realTchannelVersion = require('tchannel/package.json').version;

allocCluster.test('find connections for service', {
    size: 10,
    dummySize: 5,
    whitelist: [
        ['info', 'pruning peers'],
        ['info', 'draining peer'],
        ['info', 'draining pruned peer']
    ]
}, function t(cluster, assert) {
    var apps = cluster.apps;
    var dummies = cluster.dummies;
    var entryNode = apps[0];
    var isPartial = entryNode.clients.serviceProxy.partialAffinityEnabled;

    setup();

    function setup() {
        assert.comment('-- setup');

        collectParallel(
            dummies,
            function registerEach(dummy, i, done) {
                cluster.sendRegister(dummy, {
                    serviceName: 'Dummy'
                }, thenWait);

                function thenWait(err) {
                    if (err) {
                        done(err);
                        return;
                    }
                    cluster.untilExitsConnected('Dummy', dummy, done);
                }
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

        pruneClusterPears(cluster, assert, runTestPruneDone);
    }

    function runTestPruneDone() {
        assert.comment('-- runTestPruneDone');

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

        var cassert = CollapsedAssert();

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
            var exitInstancesKeys = Object.keys(exitInstances);
            var areConnected = exitInstancesKeys.map(function getInstanceConnected(key2) {
                var exitInstance = exitInstances[key2];
                return exitInstance.connected.out ||
                       exitInstance.connected.in;
            });

            if (isPartial) {
                assert.ok(areConnected.some(boolEye),
                          'some exit instances are connected');
            } else {
                assert.ok(areConnected.every(boolEye),
                          'all exit instances are connected');
            }

            for (var i = 0; i < exitInstancesKeys.length; i++) {
                var instance = exitInstances[exitInstancesKeys[i]];
                var initHeaders = instance.initHeaders;

                var inHeaders = initHeaders.in;
                var outHeaders = initHeaders.out;

                var procName = 'node[' + process.pid + ']';

                if (inHeaders) {
                    cassert.equal(inHeaders.tchannelLanguage, 'node');
                    cassert.equal(inHeaders.tchannelVersion, realTchannelVersion);
                    cassert.equal(inHeaders.processName, procName);
                }

                cassert.equal(outHeaders.tchannelLanguage, 'node');
                cassert.equal(outHeaders.tchannelVersion, realTchannelVersion);
                cassert.equal(outHeaders.processName, procName);
            }
        });

        cassert.report(assert, 'initHeaders are correct');

        finish(null);
    }

    function finish(err) {
        assert.comment('-- finish');
        assert.ifError(err);

        assert.end();
    }
});

function pruneClusterPears(cluster, assert, callback) {
    collectParallel(
        cluster.apps,
        function pruneEach(app, i, done) {
            var serviceProxy = app.clients.serviceProxy;
            serviceProxy.peerPruner.run(done);
        },
        function finish(_, results) {
            for (var i = 0; i < results.length; i++) {
                var res = results[i];
                assert.ifError(res.err, 'no error from pruning app ' + i);
            }
            callback();
        }
    );
}

function boolEye(x) {
    return !!x;
}
