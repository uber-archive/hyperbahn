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

// Adapted from http://jsperf.com/binarysearch-vs-indexof/4

var DEFAULT_THRESHOLD = 11;

function sortedIndexOf(array, value, threshold) {
    var min = 0;
    var max = array.length - 1;
    var mid;
    threshold = threshold == null ? DEFAULT_THRESHOLD : 0;

    // Binary search
    while (min + threshold <= max) {
        // Halve the range of potential values.
        mid = Math.floor((min + max) / 2);
        if (value === array[mid]) {
            return mid;
        } else if (value > array[mid]) {
            min = mid + 1;
        } else {
            max = mid - 1;
        }
    }

    // Fall back to linear search for small ranges
    while (min <= max && value >= array[min]) {
        if (value === array[min]) {
            return min;
        }
        min = min + 1;
    }

    // min is now the point at which the value should be inserted to retain
    // sorted order over the array.
    // However, we must return a negative value to signal that the value was
    // not found, and 0 is a valid insert position.
    // By returning the two's complement of the position, we can readily invert
    // it to obtain the insertion index, 0 unambiguously means the value was
    // already found at position 0, and -1 means that the value was not found
    // but should be inserted at position 0.
    return ~min;
}

module.exports = sortedIndexOf;
