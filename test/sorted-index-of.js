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

var test = require('tape');

var CollapsedAssert = require('./lib/collapsed-assert.js');
var sortedIndexOf = require('../lib/sorted-index-of');

test('find index of value in sorted array', function t(assert) {
    var index;
    var array = [];

    // Build
    for (index = 0; index < 100; index++) {
        array.push(index * 2);
    }

    var _assert = CollapsedAssert();

    // Validate
    for (index = 0; index < 100; index++) {
        var pos = sortedIndexOf(array, index * 2);
        _assert.equal(pos, index, 'value ' + (index * 2) + ' at ' + index);
    }

    _assert.report(assert, 'sortedIndexOf works');

    assert.end();
});

test('seek but not find value in sorted array', function t(assert) {

    // Build
    var array = [];
    for (var index = 0; index < 100; index++) {
        array.push(index * 2);
    }

    // Validate
    assert.equals(~sortedIndexOf([0, 2], 1), 1, 'cannot find value within, insert amid (reduced)');
    assert.equals(~sortedIndexOf(array, 99), 50, 'cannot find value within, insert amid');
    assert.equals(~sortedIndexOf(array, -1), 0, 'cannot find value before, insert at beginning');
    assert.equals(~sortedIndexOf(array, 1e3), 100, 'cannot find value after, insert at end');

    assert.end();
});

test('find point of insertion with no threshold for linear search', function t(assert) {
    var index;
    var array = [];

    // Build
    for (index = 0; index < 32; index++) {
        array.push(index * 2);
    }
    //  [0, 2, 4, 6, 8, 10, ...]
    // -1  1  3  5  7

    var _assert = CollapsedAssert();

    // Validate
    for (index = 0; index < 33; index++) {
        var val = index * 2 - 1;
        var pos = sortedIndexOf(array, val, null);
        _assert.equal(~pos, index, 'should insert ' + val + ' at ' + ~pos);
    }

    _assert.report(assert, 'sortedIndexOf works');

    assert.end();
});

test('find point of insertion with default threshold for linear search', function t(assert) {
    var index;
    var array = [];

    // Build
    for (index = 0; index < 32; index++) {
        array.push(index * 2);
    }
    //  [0, 2, 4, 6, 8, 10, ...]
    // -1  1  3  5  7

    var _assert = CollapsedAssert();

    // Validate
    for (index = 0; index < 33; index++) {
        var val = index * 2 - 1;
        var pos = sortedIndexOf(array, val);
        _assert.equal(~pos, index, 'should insert ' + val + ' at ' + ~pos);
    }

    _assert.report(assert, 'sortedIndexOf works');

    assert.end();
});
