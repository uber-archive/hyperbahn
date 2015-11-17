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

var extend = require('xtend');
var format = require('util').format;
var inspect = require('util').inspect;
var process = require('process');
var test = require('tape');

var CollapsedAssert = require('../../lib/collapsed-assert.js');

function searchTest(desc, rang, testFunc) {
    var args = process.argv.slice(2);

    var set = null;
    if (args.length) {
        set = JSON.parse(args[0]);
        test(desc + ' for ' + JSON.stringify(set), justThisOne);
    } else {
        test(desc, allTheTests);
    }

    function runEach(state) {
        state = extend(state, {
            relays: null,
            workers: null,
            partialRanges: null
        });
        var cassert = CollapsedAssert();
        testFunc(state, cassert);
        if (cassert.hasFailed()) {
            dumpState(state, cassert);
        }
        return cassert;
    }

    function justThisOne(assert) {
        var cassert = runEach(set);
        cassert.passthru(assert);
        assert.end();
    }

    function allTheTests(assert) {
        var bassert = CollapsedAssert();
        var baseState = rang.fillTemplate({});

        rang.withEach(baseState, function each(state) {
            var dump = JSON.stringify(state);
            var cassert = runEach(state);
            cassert.report(bassert, desc + ' for ' + dump);
        });

        bassert.report(assert, format(
            desc + ' for all ' + rang
        ));

        assert.end();
    }

}

function dumpState(state, assert) {
    assert.comment('#### state dump');
    inspect(state, {depth: null})
        .split(/\n/)
        .forEach(function each(line, i) {
            assert.comment((i > 0 ? '... ' : '>>> ') + line);
        });
}

module.exports = searchTest;
