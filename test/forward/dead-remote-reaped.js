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
var collectParallel = require('collect-parallel/array');

allocCluster.test('dead exit peers get reaped', {
    size: 10,
    namedRemotes: ['alice', 'alice', 'alice', 'alice', 'alice', 'alice', 'alice']
}, function t(cluster, assert) {
    var i;
    var alice;
    var activeNum = 3;

    // Verify that hyperban is connected to all the alices
    for (i = 0; i < cluster.namedRemotes.length; i++) {
        alice = cluster.namedRemotes[i];
        cluster.checkExitPeers(assert, {
            serviceName: alice.serviceName,
            hostPort: alice.hostPort
        });
    }

    // Reap peers that have not registered (nobody)
    reapClusterPears(cluster, assert, initialReapDone);

    function initialReapDone() {
        // Verify that all alices are still connected
        for (i = 0; i < cluster.namedRemotes.length; i++) {
            alice = cluster.namedRemotes[i];
            cluster.checkExitPeers(assert, {
                serviceName: alice.serviceName,
                hostPort: alice.hostPort
            });
        }

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

        // Some of the peers remain
        for (i = 0; i < activeNum; i++) {
            alice = cluster.namedRemotes[i];
            cluster.checkExitPeers(assert, {
                serviceName: alice.serviceName,
                hostPort: alice.hostPort,
                isDead: false // NOT DEAD YET
                // I FEEL HAPPY
            });
        }
        // Others not so much
        for (i = activeNum; i < cluster.namedRemotes.length; i++) {
            alice = cluster.namedRemotes[i];
            cluster.checkExitPeers(assert, {
                serviceName: alice.serviceName,
                hostPort: alice.hostPort,
                isDead: true
            });
        }

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
        var done = false;
        for (var i = 0; i < results.length; i++) {
            var res = results[i];
            done = done || !!res.err;
            assert.ifError(res.err, 'no unexpected error from resurrection ' + i);
        }
        if (done) {
            assert.end();
            return;
        }

        // Verify that all the peers have rejoined the fray.
        for (i = 0; i < cluster.namedRemotes.length; i++) {
            alice = cluster.namedRemotes[i];
            cluster.checkExitPeers(assert, {
                serviceName: alice.serviceName,
                hostPort: alice.hostPort
            });
        }

        // And they all lived happily ever after.
        // The end.
        assert.end();

    }

});

function reapClusterPears(cluster, assert, callback) {
    collectParallel(
        cluster.apps,
        function reapEach(app, i, done) {
            var serviceProxy = app.clients.serviceProxy;
            serviceProxy.reapPeers(done);
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
