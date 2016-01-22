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

var os = require('os');
var path = require('path');
var StaticConfig = require('static-config');
var test = require('tape');

var configDir = path.join(__dirname, '..', '..', 'config');

var ApplicationClients = require('../../clients/index.js');

test('channel listen host failures', function t(assert) {
    var oldIfaces = os.networkInterfaces;
    os.networkInterfaces = nopeIfaces;

    var config = createConfig();
    var clients = new ApplicationClients({
        argv: {
            port: 0
        },
        seedClients: {},
        config: config,
        processTitle: 'you got it',
        getHostForTchannelAttemptBackoff: 1
    });
    assert.once('end', function thenDestroy() {
        clients.destroy();
    });
    clients.bootstrap(done);

    function done(err) {
        assert.ok(err, 'expected an error');
        assert.equal(err.type, 'tchannel.get-listen-host', 'expected err type');
        assert.equal(err.numAttempts, 8, 'expected err numAttempts');
        assert.equal(err.reason, 'Expected host to be a string', 'expected err reason');
        assert.equal(err.value, 'undefined', 'expected err value');
        finish();
    }

    function nopeIfaces() {
        return {}; // nope
    }

    function finish(err) {
        os.networkInterfaces = oldIfaces;
        assert.end(err);
    }
});

function createConfig() {
    return StaticConfig({
        seedConfig: {
            'clients.uncaught-exception.file': path.join(__dirname, 'uncaught-exception.log'),
            'clients.logtron.logFile': path.join(__dirname, 'hyperbahn.log'),
            'clients.logtron.kafka': null,
            'clients.logtron.sentry': null
        },
        files: [
            path.join(configDir, 'production.json')
        ]
    });
}
