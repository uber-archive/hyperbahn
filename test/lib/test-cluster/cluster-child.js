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

var childProcess = require('child_process');
var path = require('path');
var process = require('process');
var console = require('console');

var clusterMain = path.join(
    __dirname, '..', 'child-process', 'cluster-main.js'
);

module.exports = TestClusterChildProcess;

/*eslint no-console: 0, no-process-exit: 0 */
function TestClusterChildProcess(opts) {
    if (!(this instanceof TestClusterChildProcess)) {
        return new TestClusterChildProcess(opts);
    }

    var self = this;

    self.clusterProxy = opts.clusterProxy;
    self.hostPortList = null;

    self._childProcess = null;
    self._onSpawnedListener = null;
    self._onClosedListener = null;

    self._boundOnError = _boundOnError;
    self._boundOnExit = _boundOnExit;
    self._boundOnMessage = _boundOnMessage;

    function _boundOnError(err) {
        self._onError(err);
    }

    function _boundOnExit(code) {
        self._onExit(code);
    }

    function _boundOnMessage(message) {
        self._onMessage(message);
    }
}

TestClusterChildProcess.prototype.spawn =
function spawn(onSpawned) {
    var self = this;

    self._onSpawnedListener = onSpawned;

    self._childProcess = childProcess.spawn(process.execPath, [
        clusterMain,
        '--size', String(self.clusterProxy.options.size)
    ], {
        stdio: ['pipe', process.stdout, process.stderr, null, 'ipc'],
        detached: false
    });

    self._childProcess.on('exit', self._boundOnExit);
    self._childProcess.on('error', self._boundOnError);
    self._childProcess.on('message', self._boundOnMessage);

    // TODO: Why is this needed ?
    process.on('exit', onParentExit);

    function onParentExit() {
        if (self._childProcess) {
            self._childProcess.kill();
        }
    }
};

TestClusterChildProcess.prototype.close =
function close(cb) {
    var self = this;

    self._onClosedListener = cb;

    self._childProcess.send({
        command: 'close'
    });
};

TestClusterChildProcess.prototype._onError =
function _onError(err) {
    console.error('HyperbahnTestCluster child process errored', {
        error: err
    });
    process.exit(1);
};

TestClusterChildProcess.prototype._onExit =
function _onExit(code) {
    if (code !== 0) {
        console.error('HyperbahnTestCluster child process failed', {
            exitCode: code
        });
        process.exit(code);
    }
};

TestClusterChildProcess.prototype._onMessage =
function _onMessage(message) {
    var self = this;

    if (message.command === 'bootstrapComplete') {
        self._onBootstrapComplete(message);
    } else if (message.command === 'closeComplete') {
        self._onCloseComplete(message);
    }
};

TestClusterChildProcess.prototype._onBootstrapComplete =
function _onBootstrapComplete(message) {
    var self = this;

    self.hostPortList = message.hostPortList;

    self._onSpawnedListener();
};

TestClusterChildProcess.prototype._onCloseComplete =
function _onCloseComplete(message) {
    var self = this;

    self._childProcess.disconnect();
    self._childProcess = null;

    self._onClosedListener();
};
