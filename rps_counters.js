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

/* eslint max-statements: [2, 40] */
var globalTimers = require('timers');

module.exports = RPSCounters;

var BUCKET_SIZE = 10 * 1000; // 10 second buckets

function RPSCounters(timers) {
    this.aCounters = {};
    this.bCounters = {};
    this.timer = null;
    this.curr = this.aCounters;
    this.timers = timers || globalTimers;

    this.counterKeys = [];

    var self = this;
    this.boundOnTimer = boundOnTimer;
    function boundOnTimer() {
        self.onTimer();
    }
}

RPSCounters.prototype.getCounts = function getCounts() {
    return this.curr === this.aCounters ? this.bCounters : this.aCounters;
};

RPSCounters.prototype.bootstrap = function bootstrap() {
    this.timer = this.timers.setTimeout(this.boundOnTimer, BUCKET_SIZE);
};

RPSCounters.prototype.onTimer = function onTimer() {
    this.swap();
    this.timer = this.timers.setTimeout(this.boundOnTimer, BUCKET_SIZE);
};

RPSCounters.prototype.destroy = function destroy() {
    this.timers.clearTimeout(this.timer);
};

RPSCounters.prototype.inc = function inc(sourceServiceName, destServiceName) {
    var counterName = sourceServiceName + '~~' + destServiceName;
    if (!this.curr[counterName]) {
        this.aCounters[counterName] = 0;
        this.bCounters[counterName] = 0;
        this.curr[counterName] = 1;
        this.counterKeys.push(counterName);
    } else {
        this.curr[counterName] += 1;
    }
};

RPSCounters.prototype.swap = function swap() {
    if (this.curr === this.aCounters) {
        this.curr = this.bCounters;
    } else {
        this.curr = this.aCounters;
    }

    var i;
    for (i = 0; i < this.counterKeys.length; i++) {
        this.curr[this.counterKeys[i]] = 0;
    }
};
