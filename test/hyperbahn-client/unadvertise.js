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

var DebugLogtron = require('debug-logtron');
var timers = require('timers');

var HyperbahnClient = require('tchannel/hyperbahn/index.js');
var TChannelJSON = require('tchannel/as/json');

module.exports = runTests;

if (require.main === module) {
    runTests(require('../lib/test-cluster.js'));
}

function runTests(HyperbahnCluster) {
    HyperbahnCluster.test('advertise, unadvertise and forward', {
        size: 5,
        servicePurgePeriod: 50
    }, function t(cluster, assert) {
        var steve = cluster.remotes.steve;
        var bob = cluster.remotes.bob;

        var tchannelJSON = TChannelJSON({
            logger: cluster.logger
        });

        var steveHyperbahnClient = new HyperbahnClient({
            serviceName: steve.serviceName,
            callerName: 'forward-test',
            hostPortList: cluster.hostPortList,
            tchannel: steve.channel,
            logger: DebugLogtron('hyperbahnClient')
        });
        steveHyperbahnClient.once('advertised', onAdvertised);
        steveHyperbahnClient.advertise();

        function onAdvertised() {
            assert.equal(steveHyperbahnClient.state, 'ADVERTISED', 'state should be ADVERTISED');
            steveHyperbahnClient.once('unadvertised', onUnadvertised);
            steveHyperbahnClient.unadvertise();
        }

        function onUnadvertised() {
            assert.equal(steveHyperbahnClient.latestAdvertisementResult, null, 'latestAdvertisementResult is null');
            assert.equal(steveHyperbahnClient.state, 'UNADVERTISED', 'state should be UNADVERTISED');
            untilAllExitConnsRemoved(cluster, steve, sendSteveRequest);
        }

        function sendSteveRequest() {
            tchannelJSON.send(bob.clientChannel.request({
                timeout: 5000,
                serviceName: steve.serviceName
            }), 'echo', null, 'oh hi lol', onForwarded);
        }

        function onForwarded(err, resp) {
            assert.equal(err && err.type, 'tchannel.declined', 'expected declined error');
            assert.equal(err && err.message, 'no peer available for request', 'expected "no peer available for request"');
            steveHyperbahnClient.destroy();
            assert.end();
        }
    });

    HyperbahnCluster.test('advertise, wait for connections, unadvertise and forward', {
        size: 5,
        servicePurgePeriod: 50
    }, function t(cluster, assert) {
        var steve = cluster.remotes.steve;
        var bob = cluster.remotes.bob;

        var tchannelJSON = TChannelJSON({
            logger: cluster.logger
        });

        var steveHyperbahnClient = new HyperbahnClient({
            serviceName: steve.serviceName,
            callerName: 'forward-test',
            hostPortList: cluster.hostPortList,
            tchannel: steve.channel,
            logger: DebugLogtron('hyperbahnClient')
        });

        steveHyperbahnClient.once('advertised', onAdvertised);
        steveHyperbahnClient.advertise();

        function onAdvertised() {
            untilExitsConnected(cluster, steve, onceConnected);
        }

        function onceConnected() {
            assert.equal(steveHyperbahnClient.state, 'ADVERTISED', 'state should be ADVERTISED');
            steveHyperbahnClient.once('unadvertised', onUnadvertised);
            steveHyperbahnClient.unadvertise();
        }

        function onUnadvertised() {
            assert.equal(steveHyperbahnClient.latestAdvertisementResult, null, 'latestAdvertisementResult is null');
            assert.equal(steveHyperbahnClient.state, 'UNADVERTISED', 'state should be UNADVERTISED');
            untilAllExitConnsRemoved(cluster, steve, sendSteveRequest);
        }

        function sendSteveRequest() {
            tchannelJSON.send(bob.clientChannel.request({
                timeout: 5000,
                serviceName: steve.serviceName
            }), 'echo', null, 'oh hi lol', onForwarded);
        }

        function onForwarded(err, resp) {
            assert.equal(err && err.type, 'tchannel.declined', 'expected declined error');
            assert.equal(err && err.message, 'no peer available for request', 'expected "no peer available for request"');
            steveHyperbahnClient.destroy();
            assert.end();
        }
    });

    HyperbahnCluster.test('advertise, unadvertise and re-advertise', {
        size: 5
    }, function t(cluster, assert) {
        var steve = cluster.remotes.steve;
        var steveHyperbahnClient = new HyperbahnClient({
            serviceName: steve.serviceName,
            callerName: 'forward-test',
            hostPortList: cluster.hostPortList,
            tchannel: steve.channel,
            logger: DebugLogtron('hyperbahnClient')
        });
        steveHyperbahnClient.once('advertised', onAdvertised);
        steveHyperbahnClient.advertise();

        function onAdvertised() {
            assert.equal(steveHyperbahnClient.state, 'ADVERTISED', 'state should be ADVERTISED');
            steveHyperbahnClient.once('unadvertised', onUnadvertised);
            steveHyperbahnClient.unadvertise();
        }

        function onUnadvertised() {
            assert.equal(steveHyperbahnClient.latestAdvertisementResult, null, 'latestAdvertisementResult is null');
            assert.equal(steveHyperbahnClient.state, 'UNADVERTISED', 'state should be UNADVERTISED');
            untilAllExitConnsRemoved(cluster, steve, readvertise);
        }

        function readvertise() {
            steveHyperbahnClient.once('advertised', onReadvertised);
            steveHyperbahnClient.advertise();
        }

        function onReadvertised() {
            assert.equal(steveHyperbahnClient.state, 'ADVERTISED', 'state should be ADVERTISED');
            steveHyperbahnClient.destroy();
            assert.end();
        }
    });

    HyperbahnCluster.test('advertise, wait for connections, unadvertise and re-advertise', {
        size: 5
    }, function t(cluster, assert) {
        var steve = cluster.remotes.steve;
        var steveHyperbahnClient = new HyperbahnClient({
            serviceName: steve.serviceName,
            callerName: 'forward-test',
            hostPortList: cluster.hostPortList,
            tchannel: steve.channel,
            logger: DebugLogtron('hyperbahnClient')
        });

        steveHyperbahnClient.once('advertised', onAdvertised);
        steveHyperbahnClient.advertise();

        function onAdvertised() {
            untilExitsConnected(cluster, steve, onceConnected);
        }

        function onceConnected() {
            assert.equal(steveHyperbahnClient.state, 'ADVERTISED', 'state should be ADVERTISED');
            steveHyperbahnClient.once('unadvertised', onUnadvertised);
            steveHyperbahnClient.unadvertise();
        }

        function onUnadvertised() {
            assert.equal(steveHyperbahnClient.latestAdvertisementResult, null, 'latestAdvertisementResult is null');
            assert.equal(steveHyperbahnClient.state, 'UNADVERTISED', 'state should be UNADVERTISED');
            untilAllExitConnsRemoved(cluster, steve, readvertise);
        }

        function readvertise() {
            steveHyperbahnClient.once('advertised', onReadvertised);
            steveHyperbahnClient.advertise();
        }

        function onReadvertised() {
            assert.equal(steveHyperbahnClient.state, 'ADVERTISED', 'state should be ADVERTISED');
            steveHyperbahnClient.destroy();
            // TODO: wait for connections too
            assert.end();
        }
    });
}

function untilExitsConnected(cluster, remote, callback) {
    var exits = cluster.apps[0].clients.egressNodes.exitsFor(remote.serviceName);
    var numExists = Object.keys(exits).length;
    remote.channel.connectionEvent.on(onConn);
    checkConns();

    function onConn(conn) {
        conn.identifiedEvent.on(checkConns);
    }

    function checkConns(idInfo, newConn) {
        if (newConn) {
            newConn.identifiedEvent.removeListener(checkConns);
        }

        var got = {};
        forEachConn(remote, function each(conn, peer) {
            if (exits[peer.hostPort] !== undefined && conn.direction === 'in') {
                got[peer.hostPort] = true;
            }
        });
        var gotExits = Object.keys(got).length;
        if (gotExits >= numExists) {
            finish();
        }
    }

    function finish() {
        remote.channel.connectionEvent.removeListener(onConn);
        callback();
    }
}

function untilAllExitConnsRemoved(cluster, remote, callback) {
    var exits = cluster.apps[0].clients.egressNodes.exitsFor(remote.serviceName);
    var count = 1;
    forEachConn(remote, function each(conn, peer) {
        if (exits[peer.hostPort]) {
            count++;
            waitForClose(conn, onConnClose);
        }
    });
    timers.setImmediate(onConnClose);

    function onConnClose() {
        if (--count <= 0) {
            callback(null);
        }
    }
}

function forEachConn(remote, each) {
    var peers = remote.channel.peers.values();
    for (var i = 0; i < peers.length; i++) {
        var peer = peers[i];
        for (var j = 0; j < peer.connections.length; j++) {
            var conn = peer.connections[j];
            each(conn, peer);
        }
    }
}

function waitForClose(conn, listener) {
    var done = false;

    conn.errorEvent.on(onEvent);
    conn.closeEvent.on(onEvent);

    function onEvent() {
        if (!done) {
            done = true;
            listener(conn);
        }
    }
}
