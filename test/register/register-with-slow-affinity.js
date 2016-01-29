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

var setTimeout = require('timers').setTimeout;
var setImmediate = require('timers').setImmediate;

var CollapsedAssert = require('../lib/collapsed-assert.js');
var allocCluster = require('../lib/test-cluster.js');

allocCluster.test('register with slow affine', {
    size: 10,
    dummies: 1,
    remoteConfig: {
        'circuits.enabled': true
    }
}, function t(cluster, assert) {
    cluster.logger.whitelist(
        'info', 'error for timed out outgoing response'
    );
    cluster.logger.whitelist(
        'info', 'got call response for timed out call request'
    );
    cluster.logger.whitelist(
        'warn', 'Relay advertise failed with expected err'
    );
    cluster.logger.whitelist(
        'info', 'circuit became unhealthy'
    );

    var i;
    var dummy = cluster.dummies[0];
    var exitNodes = cluster.getExitNodes('hello-bob');
    for (i = 0; i < cluster.apps.length; i++) {
        var channel = cluster.apps[i].clients.tchannel;
        var handler = channel.subChannels.hyperbahn.handler;
        handler.relayAdRetryTime = 100;
    }

    forceTimeout(exitNodes[1]);

    var counter = 100;

    setTimeout(inspectLogs, 3000);
    sendNext();

    function sendNext() {
        if (--counter === 0) {
            return;
        }

        cluster.sendRegister(dummy, {
            serviceName: 'hello-bob',
            timeout: 500
        }, noop);

        setImmediate(sendNext);
    }

    function inspectLogs() {
        var logs = cluster.logger.items();
        var j;
        var k;

        var advertiseFails = [];
        for (j = 0; j < logs.length; j++) {
            if (logs[j].msg === 'Relay advertise failed with expected err') {
                advertiseFails.push(logs[j]);
            }
        }

        assert.ok(
            advertiseFails.length >= 40 &&
            advertiseFails.length <= 70,
            'expected ' + advertiseFails.length +
                ' to be between 40 & 70 logs'
        );

        var cassert = CollapsedAssert();
        for (k = 0; k < advertiseFails.length; k++) {
            var line = advertiseFails[k];

            var err = line.meta.error;
            cassert.ok(err.type === 'tchannel.declined',
                'expected err: ' + err.type + ' to be a declined'
            );
        }
        cassert.report(assert, 'all logLines are fine');

        var circuitUnhealthy = [];
        for (j = 0; j < logs.length; j++) {
            if (logs[j].msg === 'circuit became unhealthy') {
                circuitUnhealthy.push(logs[j]);
            }
        }

        assert.ok(circuitUnhealthy.length > 1,
            'expected some circuitUnhealthy messages');

        for (k = 0; k < circuitUnhealthy.length; k++) {
            line = circuitUnhealthy[k];

            assert.equal(line.meta.serviceName, 'hyperbahn',
                'expected hyperbahn to be circuit broken');
        }

        assert.end();
    }
});

function forceTimeout(app) {
    var channel = app.clients.tchannel;
    var handler = channel.subChannels.hyperbahn.handler;

    var oldHandle = handler.handleRelay;
    handler.handleRelay = handleRelayProxy;

    function handleRelayProxy() {
        var rand = Math.random();

        if (rand < 0.3) {
            return oldHandle.apply(this, arguments);
        }
    }
}

function noop() {}
