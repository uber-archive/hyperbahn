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

/* eslint-disable no-console */
/* global console */

var allocCluster = require('../lib/test-cluster.js');
var collectParallel = require('collect-parallel/array');

var DUMP_LOGS = false;

allocCluster.test('dead exit peers get reaped', {
    size: 10,
    namedRemotes: ['alice', 'alice', 'alice', 'alice', 'alice', 'alice', 'alice'],
    whitelist: [
        // TODO: this is debt, this should not be an expected log; we should
        // understand and fix the cause of and need for this audit
        ['warn', 'partial affinity audit fail'],

        ['info', 'implementing affinity change'],
        ['info', 'pruning ex-affinity peers'],
        ['info', 'draining ex-affinity peer'],
        ['info', 'draining peer'],
        ['info', 'stopping peer drain'],
        ['info', 'Refreshing service peer affinity'],
        ['info', 'reaping dead peers'],
        ['info', 'reaping dead peer'],
        ['info', 'pruning peers'],
        ['info', 'draining pruned peer'],
        ['info', 'refreshed peer partially']
    ]
}, function t(cluster, assert) {
    var activeNum = 3;

    // for more determinism
    cluster.namedRemotes.sort(function byHostPort(a, b) {
        if (a.hostPort < b.hostPort) {
            return -1;
        } else if (a.hostPort > b.hostPort) {
            return 1;
        }
        return 0;
    });

    pruneClusterPears(cluster, assert, initialPruneDone);

    function initialPruneDone() {
        takeLogs();
        assert.comment('- initialPruneDone');

        // Verify that hyperban is connected to all the alices
        checkAllExitPeers(cluster, assert, null);

        // Reap peers that have not registered (nobody)
        reapClusterPears(cluster, assert, initialReapDone);
    }

    function initialReapDone() {
        takeLogs();
        assert.comment('- initialReapDone');

        // Verify that all alices are still connected
        checkAllExitPeers(cluster, assert, null);

        // Some of the peers re-register
        collectParallel(
            cluster.namedRemotes.slice(0, activeNum),
            function reregEach(alice, i, done) {
                cluster.sendRegister(alice.channel, {
                    serviceName: alice.serviceName
                }, done);
            },
            afterReRegister
        );
    }

    function afterReRegister(_, results) {
        takeLogs();
        assert.comment('- afterReRegister');

        var done = false;
        for (var i = 0; i < results.length; i++) {
            var res = results[i];
            done = done || !!res.err;
            assert.ifError(res.err, 'no unexpected error from rereg ' + i);
        }
        if (done) {
            assert.end();
            return;
        }

        reapClusterPears(cluster, assert, afterReapPeers);
    }

    function afterReapPeers() {
        takeLogs();
        assert.comment('- afterReapPeers');

        pruneClusterPears(cluster, assert, afterReapPrunePeers);
    }

    function afterReapPrunePeers() {
        takeLogs();
        assert.comment('- afterReapPrunePeers');

        checkAllExitPeers(cluster, assert, [
            // Some of the peers remain
            false,
            false,
            false,
            // Others not so much
            true,
            true,
            true,
            true
        ]);

        // But then everybody registers again!
        collectParallel(
            cluster.namedRemotes,
            function reregEach(alice, i, done) {
                cluster.sendRegister(alice.channel, {
                    serviceName: alice.serviceName
                }, done);
            },
            afterResurrection
        );
    }

    function afterResurrection(_, results) {
        takeLogs();
        assert.comment('- afterResurrection');

        var done = false;
        for (var i = 0; i < results.length; i++) {
            var res = results[i];
            done = done || !!res.err;

            // TODO: debug why this happens...
            if (res.err && res.err.type === 'tchannel.request.drained') {
                res.err = null;
            }

            assert.ifError(res.err, 'no unexpected error from resurrection ' + i);
        }
        if (done) {
            assert.end();
            return;
        }

        pruneClusterPears(cluster, assert, afterResPruneDone);
    }

    function afterResPruneDone() {
        takeLogs();
        assert.comment('- afterResPruneDone');

        // Verify that all the peers have rejoined the fray.
        checkAllExitPeers(cluster, assert, null);

        // And they all lived happily ever after.
        // The end.
        assert.end();

    }

    function takeLogs() {
        var logs = cluster.logger._backend.records.slice(0);
        cluster.logger._backend.records.length = 0;
        if (DUMP_LOGS) {
            logs2console(logs);
        }
        return logs;
    }
});

function logs2console(logs) {
    console.log(
        logs.map(function each(log) {
            var data = log._logData;
            return data.time + ' ' +
                data.level.toUpperCase() + ' ' +
                data.msg + ' ' +
                JSON.stringify(data.fields);
        }).join('\n')
    );
}

function reapClusterPears(cluster, assert, callback) {
    collectParallel(
        cluster.apps,
        function reapEach(app, i, done) {
            var serviceProxy = app.clients.serviceProxy;
            serviceProxy.peerReaper.run(done);
        },
        function finish(_, results) {
            for (var i = 0; i < results.length; i++) {
                var res = results[i];
                assert.ifError(res.err, 'no error from reaping app ' + i);
            }
            callback();
        }
    );
}

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

var getPeerInfo = require('../../peer-info.js');

function checkAllExitPeers(cluster, assert, isDead) {
    cluster.namedRemotes.forEach(function eachRemote(alice, i) {
        assert.comment('-- checkExitPeers for namedRemotes[' + i + ']');

        var app = cluster.apps[0];
        var exitShard = app.clients.egressNodes.exitsFor(alice.serviceName);
        var exitApps = cluster.apps.filter(function isExit(someApp) {
            return !!exitShard[someApp.tchannel.hostPort];
        });

        var peersInfo = {
            seenServiceName: {},
            numExistantPeers: 0,
            connected: {
                out: false,
                in: false
            }
        };

        exitApps.forEach(function anyAppPeerInfo(exitApp) {
            var peer = exitApp.tchannel.peers.get(alice.hostPort);
            if (!peer) {
                return;
            }
            peersInfo.numExistantPeers++;
            var peerInfo = getPeerInfo(peer);
            peerInfo.serviceNames.forEach(function eachServiceName(serviceName) {
                peersInfo.seenServiceName[serviceName] = true;
            });
            peersInfo.connected.out = peersInfo.connected.out || peerInfo.connected.out;
            peersInfo.connected.in = peersInfo.connected.in || peerInfo.connected.in;
        });
        peersInfo.serviceNames = Object.keys(peersInfo.seenServiceName);

        if (isDead && isDead[i]) {
            assert.equal(
                peersInfo.serviceNames.length, 0,
                'peer has no services');
        } else {
            assert.ok(peersInfo.numExistantPeers > 0,
                      'should have a peer on every exitApp');
            assert.ok(
                peersInfo.connected.out ||
                peersInfo.connected.in,
                'exitApp is connected to peer');
        }
    });
}
