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

/* eslint-disable no-multi-spaces */

var sortedIndexOf = require('./lib/sorted-index-of');

module.exports = PartialRange;

function PartialRange(relayHostPort, minPeersPerWorker, minPeersPerRelay) {
    this.relayHostPort     = relayHostPort || ''; // instead of this.channel.hostPort
    this.minPeersPerWorker = minPeersPerWorker || 1;
    this.minPeersPerRelay  = minPeersPerRelay || 1;
    this.relays            = null;
    this.workers           = null;
    this.affineWorkers     = null;
    this.relayIndex        = NaN;
    this.ratio             = NaN;
    this.length            = NaN;
    this.start             = NaN;
    this.stop              = NaN;
}

PartialRange.prototype.isValid =
function isValid() {
    return this.relayIndex >= 0;
};

PartialRange.prototype.compute =
function compute(relays, workers) {
    if (relays) {
        this.relays = relays;
    }

    if (workers) {
        this.workers = workers;
    }

    this.ratio      = this.workers.length / this.relays.length;
    this.relayIndex = sortedIndexOf(this.relays, this.relayHostPort);

    // istanbul ignore if
    if (this.relayIndex < 0) {
        // invalid relayIndex, stomp fields to be sure
        this.length        = NaN;
        this.start         = NaN;
        this.stop          = NaN;
        this.affineWorkers = null;
        return;
    }

    // Compute the range of workers that this relay should be connected to.
    this.length        = Math.ceil(this.minPeersPerWorker * this.ratio);  // how many peers we are going to connect to
    this.length        = Math.max(this.minPeersPerRelay, this.length);    // please always have this many
    this.length        = Math.min(this.workers.length, this.length);      // you can't have more than there are
    this.start         = Math.floor(this.relayIndex * this.ratio);
    this.stop          = Math.ceil(this.relayIndex * this.ratio + this.length) % this.workers.length;
    this.affineWorkers = sliceRange(this.workers, this.start, this.stop);
};

function sliceRange(arr, lo, hi) {
    if (lo === hi) {
        // full array
        return arr; // XXX .slice(0)?
    }

    // simple range subset
    if (hi > lo) {
        return arr.slice(lo, hi);
    }

    // the range warps around the end, so we want the complement
    var head = arr.slice(0, hi);
    var tail = arr.slice(lo, arr.length);
    return tail.concat(head);
}
