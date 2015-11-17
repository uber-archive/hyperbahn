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

var rangable = require('./lib/search/rangable.js');
var searchTest = require('./lib/search/index.js');
var PartialRange = require('../partial_range.js');

searchTest('PartialRange', rangable.Chain([
    rangable.Range('numRelays', 1, 20),
    rangable.Range('numWorkers', 0, 20),
    rangable.Range('minPeersPerWorker', 1, 10),
    rangable.Range('minPeersPerRelay', 1, 10)
]), function runEachTest(state, assert) {
    // setup
    enumRelaysAndWorkers(state);
    buildPartialRanges(state);

    // run
    computePartialRanges(state, assert);

    // checks
    checkRelays(state, assert);
    checkWorkers(state, assert);
});

function enumRelaysAndWorkers(state) {
    var i;
    var relays = [];
    var workers = [];
    for (i = 0; i < state.numRelays; i++) {
        relays.push('1.1.1.1:' + i);
    }
    for (i = 0; i < state.numWorkers; i++) {
        workers.push('2.2.2.2:' + i);
    }
    state.relays = relays.sort();
    state.workers = workers.sort();
}

function buildPartialRanges(state) {
    var partialRanges = [];
    for (var i = 0; i < state.relays.length; i++) {
        partialRanges.push(new PartialRange(
            state.relays[i],
            state.minPeersPerWorker,
            state.minPeersPerRelay
        ));
    }
    state.partialRanges = partialRanges;
}

function computePartialRanges(state, assert) {
    for (var i = 0; i < state.partialRanges.length; i++) {
        var partialRange = state.partialRanges[i];
        partialRange.compute(state.relays, state.workers, 1);
        assert.ok(
            partialRange.isValid(),
            'partialRanges[' + i + ']: should be valid after compute');
    }
}

function checkRelays(state, assert) {
    for (var i = 0; i < state.partialRanges.length; i++) {
        var partialRange = state.partialRanges[i];
        if (!partialRange.isValid()) {
            continue;
        }
        if (!state.workers.length) {
            assert.equal(
                partialRange.affineWorkers.length, 0,
                'relays[' + i + ']: expected to have no affineWorkers');
        } else if (state.workers.length < state.minPeersPerRelay) {
            assert.ok(
                partialRange.affineWorkers.length >= state.workers.length,
                    'relays[' + i + ']: should have at least numWorkers peers');
        } else {
            assert.ok(
                partialRange.affineWorkers.length >= state.minPeersPerRelay,
                    'relays[' + i + ']: should have at least minPeersPerRelay peers');
        }
    }
}

function checkWorkers(state, assert) {
    var i;

    var affineWorkerCounts = Object.create(null);
    for (i = 0; i < state.partialRanges.length; i++) {
        var partialRange = state.partialRanges[i];
        if (partialRange.isValid()) {
            for (var j = 0; j < partialRange.affineWorkers.length; j++) {
                var affineWorker = partialRange.affineWorkers[j];
                affineWorkerCounts[affineWorker] = (affineWorkerCounts[affineWorker] || 0) + 1;
            }
        }
    }

    for (i = 0; i < state.workers.length; i++) {
        if (state.relays.length < state.minPeersPerWorker) {
            assert.ok(
                affineWorkerCounts[state.workers[i]] >= state.relays.length,
                    'workers[' + i + ']: should have at least numRelays peers');
        } else {
            assert.ok(
                affineWorkerCounts[state.workers[i]] >= state.minPeersPerWorker,
                    'workers[' + i + ']: should have at least minPeersPerWorker peers');
        }
        // TODO: within -/+1 of each other?
    }
}
