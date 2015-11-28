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

var allocCluster = require('./lib/test-cluster.js');

allocCluster.test('find hosts for service', {
    size: 10
}, function t(cluster, assert) {
    var entryNode = cluster.apps[0];

    entryNode.client.getChannels(onResults);

    function onResults(err, resp) {
        if (err) {
            assert.ifErr(err);
            return assert.end();
        }

        assert.ok(resp.ok);

        var serviceKeys = Object.keys(resp.body);
        for (var i = 0; i < serviceKeys.length; i++) {
            var serviceName = serviceKeys[i];
            var channelInfo = resp.body[serviceName];

            assert.equal(channelInfo.serviceName, serviceName,
                'serviceName should be correct');
            if (serviceName === 'autobahn' ||
                serviceName === 'ringpop'
            ) {
                assert.equal(
                    channelInfo.handlerType, 'tchannel.endpoint-handler',
                    'handler should be endpoint handler'
                );
            } else if (serviceName === 'hyperbahn') {
                assert.equal(
                    channelInfo.handlerType, 'hyperbahn.advertisement-handler',
                    'handler should be advertisement handler'
                );
            } else {
                assert.equal(
                    channelInfo.handlerType, 'tchannel.relay-handler',
                    'handler should be relay handler'
                );
            }
        }

        assert.ok(serviceKeys.length >= 3, 'expected at least 3 services');
        assert.ok(serviceKeys.indexOf('autobahn') > -1,
            'expected autobahn service to be returned'
        );
        assert.ok(serviceKeys.indexOf('hyperbahn') > -1,
            'expected hyperbahn service to be returned'
        );
        assert.ok(serviceKeys.indexOf('ringpop') > -1,
            'expected ringpop service to be returned'
        );

        assert.end();
    }
});
