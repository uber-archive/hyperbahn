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

var levels = ['debug', 'info', 'warn', 'error', 'trace'];

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

function fixFile(path, done) {
    fs.readFile(path, 'utf8', readDone);

    function readDone(err, data) {
        if (err) {
            return done(err);
        }

        var lines = data.split('\n');
        var i, j;
        for (i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('logger.') !== -1) {
                for (j = 0; j < levels.length; j++) {
                    lines[i] = replace(levels[j], lines[i]);
                }
            }
        }

        fs.writeFile(path, lines.join('\n'), done);
    }
}

function main(argv) {
    var inputFiles = argv.slice(2);
    var i;
    var todo = inputFiles.length;
    for (i = 0; i < todo; i++) {
        fixFile(inputFiles[i], fileDone);
    }

    function fileDone(err) {
        if (err) {
            throw err;
        }

        todo -= 1;

        if (todo <= 0) {
            console.log('preprocessing done');
        }
    }
}
