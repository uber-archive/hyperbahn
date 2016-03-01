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

var collectParallel = require('collect-parallel/array');
var net = require('net');

// A Turnip is a dirt-stupid TCP server that notes and closes all incoming
// connections.

module.exports.Turnips = Turnips;
module.exports.Turnip = Turnip;

function Turnips() {
    this.turnips = [];
}

Turnips.forAll =
function forAll(things, getPortHost, allReady) {
    var turnips = new Turnips();
    collectParallel(things, function createEachTurnip(thing, i, ready) {
        var portHost = getPortHost;
        turnips.turnips[i] = new Turnip(portHost[0], portHost[1], ready);
    }, allReady);
    return turnips;
};

Turnips.prototype.destroy =
function destroy(cb) {
    collectParallel(this.turnips, function destroyEach(turnip, i, done) {
        turnip.destroy(done);
    }, cb);
};

Turnips.prototype.takeConnLogs =
function takeConnLogs() {
    var logs = [];
    for (var i = 0; i < this.turnips.length; ++i) {
        logs[i] = this.turnips[i].takeConnLog();
    }
    return logs;
};

function Turnip(port, host, onListening) {
    this.server = net.createServer(boundOnConnection);
    this.connLog = [];
    this.server.listen(port, host, onListening);
    this.port = port;
    this.host = host;
    this.hostPort = host + ':' + port;

    var self = this;

    function boundOnConnection(socket) {
        self.onConnection(socket);
    }
}

Turnip.prototype.destroy =
function destroy(cb) {
    this.server.close(cb);
};

Turnip.prototype.takeConnLog =
function takeConnLog() {
    var log = this.connLog;
    this.connLog = [];
    return log;
};

Turnip.prototype.onConnection =
function onConnection(socket) {
    this.connLog.push({
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort
    });
    socket.end();
};

if (require.main === module) {
    var process = require('process');
    var util = require('util');
    main(process.argv.slice(2), process.stdout);
}

function main(args, logs) {
    /* eslint-disable no-console */
    var port = parseInt(args[0], 10) || 0;
    var host = args[1];
    var turnip = new Turnip(port, host, turnipListening);
    process.on('SIGINT', onSigInt);

    function turnipListening() {
        var addr = turnip.server.address();
        log('turnip on %j', addr);
    }

    function onSigInt() {
        log('destroying turnip');
        turnip.destroy(finish);
    }

    function finish() {
        log('turnip conn log:', turnip.takeConnLog());
    }

    function log() {
        var time = (new Date()).toISOString();
        var mess = util.format.apply(null, arguments);
        mess = util.format('%s %s\n', time, mess);
        logs.write(mess);
    }
}
