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
var path = require('path');
var console = require('console');
var process = require('process');

var levels = ['debug', 'info', 'warn', 'error', 'trace'];
var DESTDIR = 'build';

// Finds the msg of a log call in the line or the following line. Note that it
// preserves the quotes, so the returned string will already have ' around it
function findMsg(restOfLine, nextLine) {
    // try to get message
    if (restOfLine.length > 2) {
        var msgMatches = restOfLine.match(/\((['"][^{]*['"])/);
        if (msgMatches) {
            return msgMatches[1];
        }

        msgMatches = restOfLine.match(/\(([^,]*)/);
        if (msgMatches) {
            return msgMatches[1];
        }
    }

    // Not on first line, must be on next line
    msgMatches = nextLine.match(/ *(['"][^{]*['"])/);

    if (!msgMatches) {
        return null;
    }

    return msgMatches[1];
}

// Inserts an if (logger.willSample('level')) before a logsite for a particular
// level
function replace(filename, lineno, level, line, nextLine) {
    if (line.indexOf('logger.' + level) !== -1) {
        var matches = line.match(/( *)([_a-z\.]*logger).[a-z]*(.*)/);
        if (!matches) {
            throw new Error('couldn\'t match log line in replacer.js');
        }
        var whitespace = matches[1];
        var logger = matches[2];
        var restOfLine = matches[3];
        var logMsg = findMsg(restOfLine, nextLine);
        if (!logMsg) {
            throw new Error('couldn\'t find log message for ' + filename + ':' + lineno);
        }

        var ifStatement = 'if (' + logger + '.willSample(\'' + level + '\', ' + logMsg + ')) ';
        var logCall = logger + '.s' + level + restOfLine;

        return whitespace + ifStatement + logCall;
    } else {
        return line;
    }
}

function fixFile(filepath, done) {
    fs.readFile(filepath, 'utf8', readDone);
    var fullDestPath;
    var lines;

    function readDone(err, data) {
        if (err) {
            return done(err);
        }

        lines = data.split('\n');
        var i;
        var j;
        for (i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('logger.') !== -1) {
                for (j = 0; j < levels.length; j++) {
                    lines[i] = replace(filepath, i, levels[j], lines[i], lines[i + 1]);
                }
            }
        }

        fullDestPath = path.join(DESTDIR, filepath);
        fs.mkdir(path.dirname(fullDestPath), mkdirDone);
    }

    function mkdirDone() {
        fs.writeFile(fullDestPath, lines.join('\n'), done);
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
            /* eslint no-console:0 */
            console.log('preprocessing done');
        }
    }
}

if (module === require.main) {
    main(process.argv);
}
