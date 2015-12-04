// Copyright (c) 2015 Uber Technologies, Inc.

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

module.exports = validateHostPort;

function stringIsValidNumber(numAsStr) {
    var num = parseInt(numAsStr, 10);
    return num.toString() === numAsStr;
}

function validateHostPort(hostPort) {
    var parts = hostPort.split(':');
    if (parts.length !== 2) {
        return false;
    }

    var hostParts = parts[0].split('.');
    if (hostParts.length !== 4) {
        return false;
    }

    var i;
    for (i = 0; i < 4; i++) {
        if (!stringIsValidNumber(hostParts[i])) {
            return false;
        }
    }

    if (!stringIsValidNumber(parts[1])) {
        return false;
    }

    var portNum = parseInt(parts[1], 10);

    if (portNum < 0 || portNum > 65536) {
        return false;
    }
    return true;
}
