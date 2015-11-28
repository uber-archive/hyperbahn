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

var process = require('process');
var assert = require('assert');
var util = require('util');
var EventEmitter = require('events').EventEmitter;

module.exports = DrainSignalHandler;

function DrainSignalHandler(options) {
    if (!(this instanceof DrainSignalHandler)) {
        return new DrainSignalHandler(options);
    }

    var self = this;
    EventEmitter.call(self);

    assert(options.logger, 'logger required');
    self.logger = options.logger;

    assert(options.tchannel, 'tchannel required');
    self.tchannel = options.tchannel;

    assert(options.statsd, 'statsd required');
    self.statsd = options.statsd;

    assert(options.drainTimeout, 'drainTimeout required');
    self.drainTimeout = options.drainTimeout;

    self.drainStart = null;
    self.destroyed = false;
    self.drainEnd = null;
    self.drainDeadlineTimer = null;
}
util.inherits(DrainSignalHandler, EventEmitter);

DrainSignalHandler.prototype.extendLogInfo =
function extendLogInfo(info) {
    var self = this;

    info = self.tchannel.extendLogInfo(info);

    return info;
};

DrainSignalHandler.prototype.hookupSignals =
function hookupSignals() {
    var self = this;

    process.on('SIGTERM', onSigTerm);
    process.on('SIGINT', onSigInt);

    function onSigTerm() {
        self.onSigTerm();
    }

    function onSigInt() {
        self.onSigInt();
    }
};

DrainSignalHandler.prototype.onSigTerm =
function onSigTerm() {
    var self = this;

    if (self.tchannel.draining) {
        self.logger.info('got additional SIGTERM while draining', self.extendLogInfo({}));
    } else {
        self.startDrain();
    }
};

DrainSignalHandler.prototype.startDrain =
function startDrain() {
    var self = this;

    self.drainStart = self.tchannel.timers.now();
    self.logger.info('got SIGTERM, draining application', self.extendLogInfo({}));
    self.tchannel.drain('shutting down due to SIGTERM', drainedThenClose);
    self.drainDeadlineTimer = self.tchannel.timers.setTimeout(
        deadlineTimedOut,
        self.drainTimeout);

    function drainedThenClose() {
        self.drainedThenClose();
    }

    function deadlineTimedOut() {
        self.deadlineTimedOut();
    }
};

DrainSignalHandler.prototype.onSigInt =
function onSigInt() {
    var self = this;

    if (self.tchannel.draining) {
        self.finishDrain('warn', 'got SIGINT, drain aborted');
    } else if (!self.destroyed) {
        self.logger.info('got SIGINT, destroying application', self.extendLogInfo({}));
        self.destroy();
    }
};

DrainSignalHandler.prototype.deadlineTimedOut =
function deadlineTimedOut() {
    var self = this;

    self.finishDrain('warn', 'deadline timeout exceeded, closing now');
};

DrainSignalHandler.prototype.drainedThenClose =
function drainedThenClose() {
    var self = this;

    if (!self.destroyed) {
        self.finishDrain('info', 'tchannel drained, destroying application');
    }
};

DrainSignalHandler.prototype.finishDrain =
function finishDrain(level, mess, info) {
    var self = this;

    self.drainEnd = self.tchannel.timers.now();

    if (!info) {
        info = {};
    }
    var drainDuration = self.drainEnd - self.drainStart;
    self.statsd.timing('server.drain-time', drainDuration);
    info.drainDurationMs = drainDuration;
    info = self.extendLogInfo(info);

    switch (level) {
        case 'info':
            self.logger.info(mess, info);
            break;
        case 'warn':
            self.logger.warn(mess, info);
            break;
        default:
            info.invalidLogLevel = level;
            self.logger.error(mess, info);
            break;
    }

    self.tchannel.timers.clearTimeout(self.drainDeadlineTimer);
    self.drainDeadlineTimer = null;
    self.destroy();
};

DrainSignalHandler.prototype.destroy =
function destroy() {
    var self = this;

    self.destroyed = true;
    self.emit('shutdown');
};
