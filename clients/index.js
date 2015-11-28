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

var assert = require('assert');
var http = require('http');
// TODO use better module. This sometimes fails when you
// move around and change wifi networks.
var myLocalIp = require('my-local-ip');
var os = require('os');
var process = require('process');
var uncaught = require('uncaught-exception');
var fs = require('fs');
var ProcessReporter = require('process-reporter');
var NullStatsd = require('uber-statsd-client/null');
var TChannelAsJSON = require('tchannel/as/json');

var createLogger = require('./logger.js');
var DualStatsd = require('./dual-statsd.js');
var createRepl = require('./repl.js');
var HeapDumper = require('./heap-dumper.js');
var RemoteConfig = require('./remote-config.js');
var HyperbahnEgressNodes = require('../egress-nodes.js');
var SocketInspector = require('./socket-inspector.js');
var HyperbahnBatchStats = require('./batch-stats.js');

module.exports = ApplicationClients;

function ApplicationClients(options) {
    /*eslint max-statements: [2, 50] */
    if (!(this instanceof ApplicationClients)) {
        return new ApplicationClients(options);
    }

    var self = this;
    var config = options.config;

    self.lazyTimeout = null;

    // Used in setupRingpop method
    self.ringpopTimeouts = config.get('hyperbahn.ringpop.timeouts');
    self.projectName = config.get('info.project');

    // We need to move away from myLocalIp(); this fails in weird
    // ways when moving around and changing wifi networks.
    // host & port are internal fields since they are just used
    // in bootstrap and are not actually client objects.
    self._host = config.get('tchannel.host') || myLocalIp();
    self._port = options.argv.port;
    self._controlPort = options.argv.controlPort;
    self._bootFile = options.argv.bootstrapFile !== undefined ?
        JSON.parse(options.argv.bootstrapFile) :
        config.get('hyperbahn.ringpop.bootstrapFile');

    var statsOptions = config.get('clients.uber-statsd-client');
    self.statsd = options.seedClients.statsd || (
        (statsOptions && statsOptions.host && statsOptions.port) ?
            DualStatsd({
                host: statsOptions.host,
                port: statsOptions.port,
                project: config.get('info.project'),
                processTitle: options.processTitle
            }) :
            NullStatsd()
    );

    if (options.seedClients.logger) {
        self.logger = options.seedClients.logger;
        self.logReservoir = null;
    } else {
        var loggerParts = createLogger({
            team: config.get('info.team'),
            processTitle: options.processTitle,
            project: config.get('info.project'),
            kafka: config.get('clients.logtron.kafka'),
            logFile: config.get('clients.logtron.logFile'),
            console: config.get('clients.logtron.console'),
            sentry: config.get('clients.logtron.sentry'),
            statsd: self.statsd
        });
        self.logger = loggerParts.logger;
        self.logReservoir = loggerParts.logReservoir;
    }

    self.tchannelJSON = TChannelAsJSON({
        logger: self.logger
    });

    self.socketInspector = SocketInspector({
        logger: self.logger
    });
    self.socketInspector.enable();

    /*eslint no-process-env: 0*/
    var uncaughtTimeouts = config.get('clients.uncaught-exception.timeouts');
    self.onError = uncaught({
        logger: self.logger,
        statsd: self.statsd,
        statsdKey: 'uncaught-exception',
        meta: {
            project: config.get('info.project'),
            environment: process.env.NODE_ENV,
            hostname: os.hostname().split('.')[0]
        },
        backupFile: config.get('clients.uncaught-exception.file'),
        loggerTimeout: uncaughtTimeouts.loggerTimeout,
        statsdTimeout: uncaughtTimeouts.statsdTimeout,
        statsdWaitPeriod: uncaughtTimeouts.statsdWaitPeriod
    });

    self.processReporter = ProcessReporter({
        statsd: self.statsd
    });

    // This is dead code; really really soon.
    // Need HTTP server or I get fucking paged at 5am
    // Fix the nagios LOL.
    self._controlServer = http.createServer(onRequest);
    function onRequest(req, res) {
        res.end('OK');
    }

    self.batchStats = HyperbahnBatchStats({
        statsd: self.statsd,
        logger: self.logger
    });
    self.batchStats.flushStats();

    // Store the tchannel object with its peers on clients
    // Also store a json sender and a raw sender

    self.autobahnHostPortList = self.loadHostList();
    self.repl = createRepl();

    self.egressNodes = HyperbahnEgressNodes({
        defaultKValue: 10
    });

    self.heapDumper = HeapDumper({
        heapFolder: config.get('clients.heapsnapshot').folder,
        logger: self.logger
    });

    self.remoteConfig = RemoteConfig({
        configFile: config.get('clients.remote-config.file'),
        pollInterval: config.get('clients.remote-config').pollInterval,
        logger: self.logger,
        logError: config.get('clients.remote-config.logError')
    });
}

ApplicationClients.prototype.loadHostList =
function loadHostList() {
    var self = this;

    var bootFile = self._bootFile;
    if (bootFile === null || bootFile === undefined) {
        return null;
    }

    if (Array.isArray(bootFile)) {
        if (!bootFile.length) {
            self.logger.warn('got empty ringop bootstrap host list, using null instead');
            return null;
        }
        return bootFile;
    }

    if (typeof bootFile === 'string') {
        return self.loadHostListFile(bootFile);
    }

    assert(false, 'invalid bootstrap file: ' + bootFile);
};

ApplicationClients.prototype.loadHostListFile =
function loadHostListFile(bootFile) {
    var self = this;

    try {
        // load sync because startup
        return JSON.parse(fs.readFileSync(bootFile, 'utf8'));
    } catch (err) {
        self.logger.warn('failed to read ringpop bootstrap file', {
            bootstrapFile: bootFile,
            error: err
        });
    }

    return null;
};

ApplicationClients.prototype.setup =
function setup(cb) {
    var self = this;

    var counter = 2;

    self.processReporter.bootstrap();
    self.repl.start();

    self._controlServer.listen(self._controlPort, next);

    if (self.logger.bootstrap) {
        self.logger.bootstrap(next);
    } else {
        next(null);
    }

    function next(err) {
        if (err) {
            counter = 0;
            return cb(err);
        }

        if (--counter === 0) {
            return cb(null);
        }
    }
};

ApplicationClients.prototype.destroy = function destroy() {
    var self = this;

    self.socketInspector.disable();
    self.remoteConfig.destroy();
    self.processReporter.destroy();
    self.batchStats.destroy();

    self.repl.close();
    self._controlServer.close();

    if (self.logger.destroy) {
        self.logger.destroy();
    }
};
