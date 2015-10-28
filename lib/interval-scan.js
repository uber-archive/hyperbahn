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
var inherits = require('util').inherits;
var EventEmitter = require('tchannel/lib/event_emitter.js');

// TODO: track and report run stats
// - elapsed
// - lag
// - collection size at start
// - per-item elapsed

function IntervalScan(options) {
    assert(typeof options.name === 'string',
           'must have a name string');
    assert(typeof options.each === 'function',
           'each must be a function');
    assert(typeof options.getCollection === 'function',
           'getCollection must be a function');
    assert(options.timers,
           'must have timers');

    var self = this;
    EventEmitter.call(self);

    self.runBeginEvent = self.defineEvent('runBegin');
    self.runEndEvent = self.defineEvent('runEnd');

    self.name = options.name;
    self.interval = options.interval;
    self.each = options.each;
    self.getCollection = options.getCollection;
    self.timers = options.timers;

    self.timer = null;
    self.theRun = null;

    self.boundRun = run;
    function run() {
        self.run();
    }
}

inherits(IntervalScan, EventEmitter);

IntervalScan.prototype.setInterval =
function setInterval(interval) {
    var self = this;

    if (self.interval === interval) {
        return;
    }
    self.interval = interval;
    if (self.timer) {
        self.clearTimer();
        self.setTimer();
    }
};

IntervalScan.prototype.setTimer =
function setTimer() {
    var self = this;

    if (self.timer || self.theRun || self.interval <= 0) {
        return;
    }

    self.timer = self.timers.setTimeout(self.boundRun, self.interval);
};

IntervalScan.prototype.start =
function start() {
    var self = this;

    self.setTimer();
};

IntervalScan.prototype.stop =
function stop() {
    var self = this;

    self.clearTimer();
    if (self.theRun) {
        self.theRun.clearImmediate();
        self.theRun = null;
    }
};

IntervalScan.prototype.clearTimer =
function clearTimer() {
    var self = this;

    if (self.timer) {
        self.timers.clearTimeout(self.timer);
        self.timer = null;
    }
};

IntervalScan.prototype.run =
function run(callback) {
    var self = this;

    if (self.theRun) {
        if (callback) {
            callback(new Error('already running'));
        }
        return;
    }

    self.clearTimer();

    self.theRun = new IntervalScanRun(self, runDone);

    function runDone() {
        self.theRun = null;
        self.setTimer();
        if (callback) {
            callback();
        }
    }
};

function IntervalScanRun(scan, callback) {
    var self = this;

    self.scan = scan;
    self.immediate = null;
    self.keyIndex = 0;
    self.start = null;
    self.end = null;
    self.collection = null;
    self.keys = null;
    self.callback = callback;

    self.immediate = self.scan.timers.setImmediate(startRun);

    function startRun() {
        self.start = self.scan.timers.now();
        self.collection = self.scan.getCollection();
        self.keys = Object.keys(self.collection);
        self.scan.runBeginEvent.emit(self.scan, self);
        self.nextItem();
    }

    self.boundDeferNextItem = deferNextItem;
    function deferNextItem() {
        self.keyIndex++;
        self.nextItem();
    }
}

IntervalScanRun.prototype.nextItem =
function nextItem() {
    var self = this;

    if (self.keyIndex < self.keys.length) {
        var key = self.keys[self.keyIndex];
        var val = self.collection[key];
        if (val !== undefined) {
            self.scan.each(key, val);
        }
        self.immediate = self.scan.timers.setImmediate(self.boundDeferNextItem);
    } else {
        self.finish();
    }
};

IntervalScanRun.prototype.finish =
function finish() {
    var self = this;

    if (self.end === null) {
        self.end = self.scan.timers.now();
        self.scan.runEndEvent.emit(self.scan, self);
    }

    if (self.callback) {
        self.callback();
        self.callback = null;
    }
};

IntervalScanRun.prototype.clearImmediate =
function clearImmediate() {
    var self = this;

    if (self.immediate) {
        self.scan.timers.clearImmediate(self.immediate);
        self.immediate = null;
    }
};

IntervalScan.Run = IntervalScanRun;
module.exports = IntervalScan;
