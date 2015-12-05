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

/*eslint no-console: 0*/
var process = require('process');
var util = require('util');
var path = require('path');
var FakeKafkaServer = require('kafka-logger/test/lib/kafka-server');
var FakeSentryServer = require('sentry-logger/test/lib/sentry-server');
var setTimeout = require('timers').setTimeout;
var console = require('console');

var BenchmarkRunner = require('tchannel/benchmarks/');
var readBenchConfig = require('tchannel/benchmarks/read-bench-config.js');

var bahn = path.join(__dirname, 'hyperbahn-worker.js');
var multiBahn = path.join(__dirname, 'hyperbahn-multi-worker.js');

var RELAY_SERVER_PORT = 7200;

function HyperbahnBenchmarkRunner(opts) {
    if (!(this instanceof HyperbahnBenchmarkRunner)) {
        return new HyperbahnBenchmarkRunner(opts);
    }

    var self = this;
    opts.torchDelay = opts.torchDelay || 15 * 1000;
    BenchmarkRunner.call(self, opts);

    if (self.opts.multi) {
        self.startClientDelay = 5000;
    } else {
        self.startClientDelay = 1000;
    }

    self.ports.relayServerPort = RELAY_SERVER_PORT;
    self.multiInstances = opts.multiInstances || 25;
}
util.inherits(HyperbahnBenchmarkRunner, BenchmarkRunner);

HyperbahnBenchmarkRunner.prototype.startFakeSentry =
function startFakeSentry() {
    var self = this;
    self.sentry = FakeSentryServer(onSentry);

    function onSentry(msg) {
    }
};

HyperbahnBenchmarkRunner.prototype.startFakeKafka =
function startFakeKafka() {
    var self = this;
    self.kafka = FakeKafkaServer(onKafkaMessage);

    function onKafkaMessage(msg) {
    }
};

HyperbahnBenchmarkRunner.prototype.spawnRelayServer =
function spawnRelayServer() {
    var self = this;

    self.startFakeKafka();
    self.startFakeSentry();

    var procOpts = [
        '--refreshServicePeersPeriod', self.opts.refreshServicePeersPeriod,
        '--serverPort', String(self.ports.serverPort),
        '--serverServiceName', String(self.serviceName),
        '--instances', String(self.instanceCount),
        '--workerPort', String(self.ports.relayServerPort),
        '--statsdPort', String(self.ports.statsdPort),
        '--kafkaPort', String(self.kafka.port),
        '--sentryPort', String(self.sentry.address().port)
    ];

    if (self.opts.multi) {
        var hyperbahnPeers = ['127.0.0.1:' + self.ports.relayServerPort];
        for (var i = 0; i < self.multiInstances; i++) {
            var port = self.ports.relayServerPort + (i + 1);
            hyperbahnPeers.push('127.0.0.1:' + port);
        }
        procOpts.push('--ringpopList', hyperbahnPeers.join(','));

        self.spawnMultibahnProc(procOpts.concat([
            '--multiInstances', String(self.multiInstances)
        ]));

        setTimeout(spawnTheWorker, 50);
    } else {
        spawnTheWorker();
    }

    function spawnTheWorker() {
        self.opts.torchIndex = self.spawnHyperbahnProc(procOpts);
    }
};

HyperbahnBenchmarkRunner.prototype.spawnHyperbahnProc =
function spawnHyperbahnProc(procOpts) {
    var self = this;

    var hyperbahnProc = self.run(bahn, procOpts);
    var relayIndex = self.relayProcs.length;
    self.relayProcs.push(hyperbahnProc);
    hyperbahnProc.stdout.pipe(process.stderr);
    hyperbahnProc.stderr.pipe(process.stderr);

    if (self.opts.relayKillIn) {
        setTimeout(function thenKillIt() {
            console.error('killing %s[%s]', bahn, hyperbahnProc.pid);
            hyperbahnProc.kill('SIGTERM');

        }, self.opts.relayKillIn);
        console.error('set kill timer for %s[%s] in %sms',
                      bahn, hyperbahnProc.pid, self.opts.relayKillIn);
    }

    return relayIndex;
};

HyperbahnBenchmarkRunner.prototype.spawnMultibahnProc =
function spawnMultibahnProc(procOpts) {
    var self = this;

    var hyperbahnMultiProc = self.run(multiBahn, procOpts);
    var relayIndex = self.relayProcs.length;
    self.relayProcs.push(hyperbahnMultiProc);
    hyperbahnMultiProc.stdout.pipe(process.stderr);
    hyperbahnMultiProc.stderr.pipe(process.stderr);
    return relayIndex;
};

HyperbahnBenchmarkRunner.prototype.close = function close() {
    var self = this;

    BenchmarkRunner.prototype.close.call(self);

    if (self.sentry) {
        self.sentry.close();
    }
    if (self.kafka) {
        self.kafka.close();
    }
};

if (require.main === module) {
    var argv = readBenchConfig({
        '--': true,
        alias: {
            o: 'output'
        },
        boolean: ['relay', 'trace', 'debug', 'noEndpointOverhead']
    });
    process.title = 'nodejs-benchmarks-top-level-runner';
    var runner = HyperbahnBenchmarkRunner(argv);
    runner.start();
}
