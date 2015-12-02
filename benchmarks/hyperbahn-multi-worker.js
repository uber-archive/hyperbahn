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

var process = require('process');
var readBenchConfig = require('tchannel/benchmarks/read-bench-config.js');

var HyperbahnWorker = require('./hyperbahn-worker.js');

function HyperbahnMultiWorker(opts) {
    if (!(this instanceof HyperbahnMultiWorker)) {
        return new HyperbahnMultiWorker(opts);
    }

    var self = this;

    self.multiInstances = opts.multiInstances;

    self.workers = [];
    for (var i = 0; i < self.multiInstances; i++) {
        var workerPort = Number(opts.workerPort) + (i + 1);

        self.workers.push(HyperbahnWorker({
            statsdPort: opts.statsdPort,
            kafkaPort: opts.kafkaPort,
            sentryPort: opts.sentryPort,
            ringpopList: opts.ringpopList,
            serverPort: opts.serverPort,
            instances: opts.instances,
            serverServiceName: opts.serverServiceName,
            workerPort: workerPort
        }));
    }
}

HyperbahnMultiWorker.prototype.start = function start() {
    var self = this;

    for (var i = 0; i < self.workers.length; i++) {
        self.workers[i].start();
    }
};

if (require.main === module) {
    var argv = readBenchConfig();
    process.title = 'nodejs-benchmarks-hyperbahn_multi_worker';

    var worker = HyperbahnMultiWorker(argv);

    // attach before throwing exception
    process.on('uncaughtException', worker.workers[0].app.clients.onError);
    worker.start();
}
