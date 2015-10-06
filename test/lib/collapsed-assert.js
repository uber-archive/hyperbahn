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

var nodeAssert = require('assert');

module.exports = CollapsedAssert;

// TODO more methods
function CollapsedAssert() {
    if (!(this instanceof CollapsedAssert)) {
        return new CollapsedAssert();
    }

    var self = this;

    self._commands = [];
    self._failed = false;
}

CollapsedAssert.prototype.equal = function equal(a, b, msg, extra) {
    var self = this;

    if (a !== b) {
        self._failed = true;
    }

    self._commands.push(['equal', a, b, msg, extra]);
};

CollapsedAssert.prototype.fail = function fail(msg, extra) {
    var self = this;

    self._failed = true;
    self._commands.push(['fail', msg, extra]);
};

CollapsedAssert.prototype.report = function report(realAssert, message) {
    var self = this;

    nodeAssert(message, 'must pass message');

    if (!self._failed) {
        return realAssert.ok(true, message);
    }

    for (var i = 0; i < self._commands; i++) {
        var command = self._commands[i];

        var method = command.shift();
        realAssert[method].apply(realAssert, command);
    }
};
