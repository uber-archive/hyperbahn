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
var NullLogtron = require('null-logtron');

var path = require('path');
var fs = require('fs');
var crypto = require('crypto');

var HyperbahnClient = require('tchannel/hyperbahn/index.js');
var TChannelThrift = require('tchannel/as/thrift.js');

var thriftSource = fs.readFileSync(path.join(__dirname, '../../hyperbahn.thrift'), 'utf8');

module.exports = runTests;

if (require.main === module) {
    runTests(require('../lib/test-cluster.js'));
}

function runTests(HyperbahnCluster) {
    HyperbahnCluster.test('discover success', {
        size: 5
    }, function t(cluster, assert) {
        var bob = cluster.remotes.bob;
        var steve = cluster.remotes.steve;

        var discoverClient;

        var client = new HyperbahnClient({
            serviceName: 'hello-bob',
            callerName: 'hello-bob-test',
            hostPortList: cluster.hostPortList,
            tchannel: bob.channel,
            logger: DebugLogtron('hyperbahnClient')
        });

        client.once('advertised', onAdvertised);
        client.advertise();

        function onAdvertised() {
            discoverClient = new HyperbahnClient({
                serviceName: 'hello-steve',
                callerName: 'hello-steve-test',
                hostPortList: cluster.hostPortList,
                tchannel: steve.channel,
                logger: DebugLogtron('hyperbahnClient')
            });

            discoverClient.discover({serviceName: 'hello-bob'}, onDiscovered);
        }

        function onDiscovered(err, hosts) {
            assert.error(err, "foo", err);  // Should not have error here

            assert.deepLooseEqual(hosts, [bob.channel.hostPort]);

            client.destroy();
            discoverClient.destroy();
            assert.end();
        }
    });

    HyperbahnCluster.test('discover no peers', {
        size: 5
    }, function t(cluster, assert) {
        var steve = cluster.remotes.steve;

        var discoverClient = new HyperbahnClient({
            serviceName: 'hello-steve',
            callerName: 'hello-steve-test',
            hostPortList: cluster.hostPortList,
            tchannel: steve.channel,
            logger: DebugLogtron('hyperbahnClient')
        });

        discoverClient.discover(null, onDiscovered);

        function onDiscovered(err, hosts) {
            assert.error(!err, "NoPeersAvailable response", "expected NoPeersAvailable error");
            assert.deepEqual(hosts, [], "expect empty host list");

            discoverClient.destroy();
            assert.end();
        }
    });

    HyperbahnCluster.test('discover hard tchannel error', {
        size: 5
    }, function t(cluster, assert) {
        var steve = cluster.dummies[1];

        var discoverClient = new HyperbahnClient({
            serviceName: 'hello-steve',
            callerName: 'hello-steve-test',
            hostPortList: [steve.hostPort],
            tchannel: steve,
            // Use a null logger here because the debugger one throws an
            // exception when an error is logged.
            logger: NullLogtron('hyperbahnClient')
        });

        discoverClient.discover({timeout: 100}, onDiscovered);

        function onDiscovered(err, hosts) {
            assert.error(!err, "expect TChannel error");
            assert.deepEqual(hosts, null, "expect null host list");

            discoverClient.destroy();
            assert.end();
        }
    });
}
