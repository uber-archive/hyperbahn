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

var fs = require('fs');

// Inserts an if (logger.willSample('level')) before a logsite for a particular
// level
function replace(level, line) {
    if (line.indexOf('logger.' + level) !== -1) {
        var matches = line.match(/( *)([a-z\.]*logger).[a-z]*(.*)/);
        if (!matches) {
            throw new Error('couldn\'t match log line in replacer.js');
        }
        var whitespace = matches[1];
        var logger = matches[2];
        var restOfLine = matches[3];

        var ifStatement = whitespace + 'if (' + logger + '.willSample(\'' + level + '\')) ';
        var logCall = logger + '.s' + level + restOfLine;

        return ifStatement + logCall;
    } else {
        return line;
    }
}

var input = process.argv[2];
var contents = fs.readFileSync(input, 'utf8').split('\n');
var i;
var levels = ['debug', 'info', 'warn', 'error', 'trace'];
for (i = 0; i < contents.length; i++) {
    if (contents[i].indexOf('logger.') !== -1) {
        levels.forEach(function eachLevel(level) {
            contents[i] = replace(level, contents[i]);
        });
    }
}

// Modify file in-place
fs.writeFileSync(input, contents.join('\n'));
