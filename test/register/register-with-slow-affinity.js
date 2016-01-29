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
    var exitNodes = cluster.getExitNodes('hello-bob');
    for (i = 0; i < cluster.apps.length; i++) {
        var channel = cluster.apps[i].clients.tchannel;
        var handler = channel.subChannels.hyperbahn.handler;
        handler.relayAdRetryTime = 100;
    }

    forceTimeout(exitNodes[1]);

    sendNRegisters(cluster, 100, inspectLogs)

    function inspectLogs(err, errors) {
        assert.ifError(err);

        checkAdvertiseMessages();
        checkCircuitUnhealthy();
        checkClientErrors(errors);

        assert.end();
    }

    function checkAdvertiseMessages() {
        var logs = cluster.logger.items();

        var advertiseFails = [];
        for (var j = 0; j < logs.length; j++) {
            if (logs[j].msg === 'Relay advertise failed with expected err') {
                advertiseFails.push(logs[j]);
            }
        }

        assert.ok(
            advertiseFails.length <= 30,
            'expected ' + advertiseFails.length +
                ' to be between 0 & 30 logs'
        );

        var cassert = CollapsedAssert();
        for (var k = 0; k < advertiseFails.length; k++) {
            var line = advertiseFails[k];

            var err = line.meta.error;
            cassert.ok(err.type === 'tchannel.declined' ||
                err.type === 'tchannel.timeout' ||
                err.type === 'tchannel.request.timeout',
                'expected err: ' + err.type + ' to be a declined'
            );
        }
        cassert.report(assert, 'all logLines are fine');
    }

    function checkCircuitUnhealthy() {
        var logs = cluster.logger.items();

        var circuitUnhealthy = [];
        for (var j = 0; j < logs.length; j++) {
            if (logs[j].msg === 'circuit became unhealthy') {
                circuitUnhealthy.push(logs[j]);
            }
        }

        assert.ok(circuitUnhealthy.length > 1,
            'expected some circuitUnhealthy messages');

        for (var k = 0; k < circuitUnhealthy.length; k++) {
            var line = circuitUnhealthy[k];

            assert.equal(line.meta.serviceName, 'hyperbahn',
                'expected hyperbahn to be circuit broken');

            if (line.meta.hostPort === exitNodes[1].hostPort) {
                assert.ok(
                    line.meta.endpointName === 'relay-ad' ||
                    line.meta.endpointName === 'ad',
                    'expected endpointName to be ad or relay-ad'
                );
            } else {
                assert.equal(line.meta.endpointName, 'ad',
                    'expected endpointName to be ad');
            }
        }
    }

    function checkClientErrors(errors) {
        assert.ok(
            errors.length >= 80 &&
            errors.length <= 100,
            'expected ' + errors.length + ' to be between 80 & 100'
        );

        var buckets = {};

        for (var j = 0; j < errors.length; j++) {
            var e = errors[j];

            if (!buckets[e.type]) {
                buckets[e.type] = 0;
            }

            buckets[e.type]++;
        }

        var declined = buckets['tchannel.declined'];
        var timeouts = buckets['tchannel.request.timeout'] +
            buckets['tchannel.timeout'];

        assert.ok(
            timeouts >= 10 && timeouts <= 30,
            'expected between 10 & 30 timeouts but got: ' + timeouts
        );
        assert.ok(
            declined >= 60 && declined <= 85,
            'expected between 60 & 85 declined but got: ' + declined
        );
    }
});

function sendNRegisters(cluster, n, cb) {
    var dummy = cluster.dummies[0];
    var exitNodes = cluster.getExitNodes('hello-bob');
    var counter = n;
    var errors = [];

    sendNext();

    function sendNext() {
        if (--counter === 0) {
            return setTimeout(invokeCb, 500);
        }

        cluster.sendRegister(dummy, {
            serviceName: 'hello-bob',
            host: exitNodes[0].hostPort,
            timeout: 500
        }, onError);

        setTimeout(sendNext, 50);
    }

    function onError(err) {
        if (err) {
            errors.push(err);
        }
    }

    function invokeCb() {
        cb(null, errors);
    }
}

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
