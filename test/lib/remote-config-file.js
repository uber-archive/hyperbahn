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
var process = require('process');
var RemoteConfig = require('../../clients/remote-config.js');
var DebugLogtron = require('debug-logtron');

module.exports = RemoteConfigFile;

function RemoteConfigFile(name) {
    if (!(this instanceof RemoteConfigFile)) {
        return new RemoteConfigFile(name);
    }

    var self = this;

    if (!name) {
        name = 'UNKNOWN[' + process.pid + ']';
    } else {
        name += '[' + process.pid + ']';
    }
    self.filePath = path.join(
        '/tmp', 'remote_config_' + name + '.json'
    );
}

RemoteConfigFile.prototype.write =
function write(opts) {
    var self = this;
    var arr = objToKeyValArray(opts);
    var json = JSON.stringify(arr, null, 4);
    self.writeFile(json);
};

RemoteConfigFile.prototype.writeFile = function writeFile(content) {
    var self = this;
    fs.writeFileSync(
        self.filePath,
        content,
        'utf8'
    );
};

RemoteConfigFile.prototype.create = function create(opts) {
    var self = this;
    var logger = DebugLogtron('remoteconfig');
    opts = opts || {};

    logger.whitelist('error', '[remote-config] could not read file');

    return RemoteConfig({
        configFile: self.filePath,
        pollInterval: opts.pollInterval,
        logger: logger
    });
};

RemoteConfigFile.prototype.clear = function clear() {
    var self = this;
    if (fs.existsSync(self.filePath)) {
        fs.unlinkSync(self.filePath);
    }
};

function objToKeyValArray(obj) {
    if (obj === null ||
        obj === undefined ||
        typeof obj !== 'object') {
        return [];
    }

    if (Array.isArray(obj)) {
        return obj;
    }

    var arr = [];
    for (var keys = Object.keys(obj), i = 0; i < keys.length; i++) {
        arr.push({
            key: keys[i],
            value: obj[keys[i]]
        });
    }
    return arr;
}
