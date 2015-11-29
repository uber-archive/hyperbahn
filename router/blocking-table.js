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

var assert = require('assert');

module.exports = BlockingTable;

function BlockingTable() {
    if (!(this instanceof BlockingTable)) {
        return new BlockingTable();
    }

    var self = this;

    self._blockingTable = null;
    self._blockingTableRemoteConfig = null;
}

BlockingTable.prototype.isBlocked =
function isBlocked(cn, serviceName) {
    var self = this;
    cn = cn || '*';
    serviceName = serviceName || '*';

    if (self._blockingTable &&
        (self._blockingTable[cn + '~~' + serviceName] ||
        self._blockingTable['*~~' + serviceName] ||
        self._blockingTable[cn + '~~*'])) {
        return true;
    }

    if (self._blockingTableRemoteConfig &&
        (self._blockingTableRemoteConfig[cn + '~~' + serviceName] ||
        self._blockingTableRemoteConfig['*~~' + serviceName] ||
        self._blockingTableRemoteConfig[cn + '~~*'])) {
        return true;
    }

    return false;
};

BlockingTable.prototype.block =
function block(cn, serviceName) {
    var self = this;
    cn = cn || '*';
    serviceName = serviceName || '*';
    self._blockingTable = self._blockingTable || {};
    assert(cn !== '*' || serviceName !== '*', 'at least one of cn/serviceName should be provided');
    self._blockingTable[cn + '~~' + serviceName] = Date.now();
};

BlockingTable.prototype.unblock =
function unblock(cn, serviceName) {
    var self = this;
    if (!self._blockingTable) {
        return;
    }

    cn = cn || '*';
    serviceName = serviceName || '*';
    delete self._blockingTable[cn + '~~' + serviceName];
    if (Object.keys(self._blockingTable).length === 0) {
        self._blockingTable = null;
    }
};

BlockingTable.prototype.blockRemoteConfig =
function blockRemoteConfig(cn, serviceName) {
    var self = this;
    cn = cn || '*';
    serviceName = serviceName || '*';
    self._blockingTableRemoteConfig = self._blockingTableRemoteConfig || {};
    assert(cn !== '*' || serviceName !== '*', 'at least one of cn/serviceName should be provided');
    self._blockingTableRemoteConfig[cn + '~~' + serviceName] = Date.now();
};

BlockingTable.prototype.unblockAllRemoteConfig =
function unblockAllRemoteConfig() {
    var self = this;
    self._blockingTableRemoteConfig = null;
};
