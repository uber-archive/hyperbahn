// Copyright (c) 2015 Uber Technologies, Inc.

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

var clearTimeout = require('timers').clearTimeout;
var setTimeout = require('timers').setTimeout;
var process = require('process');
var assert = require('assert');
var path = require('path');
var StaticConfig = require('static-config');
var readBenchConfig = require('tchannel/benchmarks/read-bench-config.js');

var RemoteConfigFile = require('../test/lib/remote-config-file.js');
var HyperbahnApplication = require('../app.js');

module.exports = HyperbahnWorker;

function HyperbahnWorker(opts) {
    /*eslint max-statements: [2, 25]*/
    if (!(this instanceof HyperbahnWorker)) {
        return new HyperbahnWorker(opts);
    }

    var self = this;

    assert(opts.serverPort, 'serverPort required');
    assert(opts.serverServiceName, 'serverServiceName required');
    assert(opts.instances, 'instances required');
    assert(opts.workerPort, 'workerPort required');

    assert(opts.sentryPort, 'sentryPort required');
    assert(opts.kafkaPort, 'kafkaPort required');

    self.statsdPort = Number(opts.statsdPort);
    self.kafkaPort = Number(opts.kafkaPort);
    self.sentryPort = Number(opts.sentryPort);
    self.ringpopList = opts.ringpopList ? opts.ringpopList.split(',') : [];
    self.instances = Number(opts.instances);
    self.serverServiceName = opts.serverServiceName;
    self.serverPort = Number(opts.serverPort);

    self.remoteConfigFile = RemoteConfigFile(String(self.serverPort));
    self.remoteConfigFile.write(opts.remoteConfig);

    self.refreshServicePeersPeriod = opts.refreshServicePeersPeriod || 0;
    self.refreshServicePeersTimer = null;

    self.config = self.createConfig();
    self.app = HyperbahnApplication(self.config, {
        processTitle: process.title,
        argv: {
            port: Number(opts.workerPort)
        }
    });
}

HyperbahnWorker.prototype.start = function start() {
    var self = this;

    self.app.bootstrapAndListen(onAppReady);

    function onAppReady(err) {
        if (err) {
            throw err;
        }
        refreshServicePeers();
        self.app.on('destroy', onAppDestroyed);
    }

    function onAppDestroyed() {
        clearTimeout(self.refreshServicePeersTimer);
        self.refreshServicePeersTimer = null;
    }

    function refreshServicePeers() {
        clearTimeout(self.refreshServicePeersTimer);
        self.refreshServicePeersTimer = null;

        var basePort = self.serverPort;
        var serviceProxy = self.app.clients.serviceProxy;
        for (var i = 0; i < self.instances; i++) {
            var targetHostPort = '127.0.0.1:' + (basePort + i);
            serviceProxy.refreshServicePeer(
                self.serverServiceName, targetHostPort
            );
        }

        if (self.refreshServicePeersPeriod) {
            self.refreshServicePeersTimer = setTimeout(refreshServicePeers, self.refreshServicePeersPeriod);
        }
    }
};

HyperbahnWorker.prototype.createConfig = function createConfig() {
    var self = this;

    var configDir = path.join(__dirname, '..', 'config');

    return StaticConfig({
        files: [
            path.join(configDir, 'production.json')
        ],
        seedConfig: {
            'clients.remote-config.file': self.remoteConfigFile.filePath,

            'clients.uber-statsd-client': {
                host: '127.0.0.1',
                port: self.statsdPort
            },
            'clients.logtron.kafka': {
                leafHost: '127.0.0.1',
                leafPort: self.kafkaPort
            },
            'clients.logtron.logFile': null,
            // 'clients.logtron.console': true,
            'clients.logtron.sentry': {
                id: 'http://bs:bs@localhost:' + self.sentryPort
            },
            'tchannel.host': '127.0.0.1',
            'hyperbahn.ringpop.bootstrapFile': self.ringpopList
        }
    });
};

if (require.main === module) {
    var argv = readBenchConfig();
    process.title = 'nodejs-benchmarks-hyperbahn_worker';

    var worker = HyperbahnWorker(argv);

    // attach before throwing exception
    process.on('uncaughtException', worker.app.clients.onError);
    worker.start();
}
