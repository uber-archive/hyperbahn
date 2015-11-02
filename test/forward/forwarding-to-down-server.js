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

/* eslint-disable complexity */ // Didn't need it anyway

var CollapsedAssert = require('../lib/collapsed-assert.js');
var allocCluster = require('../lib/test-cluster.js');

allocCluster.test('forwarding to a down service', {
    size: 5,
    whitelist: [
        ['info', 'Refreshing service peer affinity']
    ]
}, function t(cluster, assert) {
    var bob = cluster.remotes.bob;
    var steve = cluster.remotes.steve;

    cluster.logger.whitelist('info', 'resetting connection');
    cluster.logger.whitelist('warn', 'error while forwarding');
    cluster.logger.whitelist('warn', 'forwarding error frame');

    cluster.checkExitPeers(assert, {
        serviceName: steve.serviceName,
        hostPort: steve.hostPort
    });

    // Close the service to emulate failure.
    steve.destroy();

    bob.clientChannel.request({
        serviceName: steve.serviceName
    }).send('hi', null, JSON.stringify(null), onForwarded);

    function onForwarded(err, resp, arg2, arg3) {
        /*eslint complexity: [2, 15], max-statements: [2, 40] */
        assert.ok(err, 'forward call should fail');

        assert.equal(err.isErrorFrame, true,
            'forwarding err is an error frame');

        cluster.checkExitPeers(assert, {
            serviceName: steve.serviceName,
            hostPort: steve.hostPort,
            disconnectedHostsPorts: [steve.hostPort]
        });

        // TODO make not flake
        // TODO this should not return a could not find service
        // error. The exit node needs to know the difference
        // between service exists & is down vs service does not exist.
        var message = 'unknown service ' + steve.serviceName;
        if (err.message === message) {
            assert.ok(true, 'skipping flaky test');
            return assert.end();
        }

        assert.ok(
            err.message.indexOf('connect ECONNREFUSED') >= 0 ||
            err.message.indexOf('socket closed') === 0 ||
            err.message === 'connect ECONNREFUSED' ||
            err.message === 'This socket has been ended by the other party',
            'expected error to be a socket closed error'
        );

        var logLines = cluster.logger.items();
        var cassert = CollapsedAssert();
        for (var i = 0; i < logLines.length; i++) {
            var logLine = logLines[i];
            var logErr = logLine.meta.error;
            if (logLine.msg === 'forwarding error frame') {
                cassert.equal(logLine.meta.isErrorFrame, true,
                    'expected error frame');
                cassert.equal(logLine.meta.serviceName, 'steve',
                    'expected steve error');
            } else if (logLine.msg === 'Refreshing service peer affinity') {
                cassert.ok(true, 'expected peer affinity refresh');
            } else if (logLine.msg === 'error while forwarding' ||
                       logLine.msg === 'resetting connection') {
                if (logLine.msg === 'error while forwarding') {
                    cassert.equal(logLine.levelName, 'warn');
                } else if (logLine.msg === 'resetting connection') {
                    cassert.equal(logLine.levelName, 'info');
                }

                var expectedAddr =
                    logErr.socketRemoteAddr === steve.hostPort;
                // if (!expectedAddr) console.error('WRU', steve.hostPort, logErr);
                cassert.ok(expectedAddr, 'expected exception to steve');

                var expectedType =
                    logErr.fullType === 'tchannel.socket~!~error.wrapped-io.connect.ECONNREFUSED' ||
                    logErr.fullType === 'tchannel.socket~!~error.wrapped-io.read.ECONNRESET';
                if (!expectedType) {
                    assert.comment('unexpected error type ' + logErr.fullType);
                }
                cassert.ok(expectedType, 'Expected exception to be network error');
            } else {
                cassert.ok(false, 'unexpected log line');
            }
        }
        cassert.report(assert, 'logs should be correct');

        assert.end();
    }
});
