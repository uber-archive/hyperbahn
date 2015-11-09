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

var tape = require('tape');
var tapeCluster = require('tape-cluster');

var ClusterChild = require('./cluster-child.js');
var ApplicationProxy = require('./application-proxy.js');

TestClusterProxy.test = tapeCluster(tape, TestClusterProxy);

module.exports = TestClusterProxy;

function TestClusterProxy(opts) {
    if (!(this instanceof TestClusterProxy)) {
        return new TestClusterProxy(opts);
    }

    var self = this;

    self.options = new TestClusterOptions(opts);

    // TODO: ensure we have a logger.
    self.logger = null;

    // Instances of TestApplicationProxy
    self.apps = [];

    self._clusterChild = new ClusterChild({
        clusterProxy: self
    });
}

function TestClusterOptions(opts) {
    var self = this;

    opts = opts || {};

    self.size = opts.size;
    self.dummySize = opts.dummySize;
    self.namedRemotes = opts.namedRemotes;
}

TestClusterProxy.prototype.bootstrap = function bootstrap(cb) {
    var self = this;

    self._clusterChild.spawn(onSpawned);

    function onSpawned(err) {
        if (err) {
            return cb(err);
        }

        var hostPortList = self._clusterChild.hostPortList;
        for (var i = 0; i < hostPortList.length; i++) {
            self.apps.push(new ApplicationProxy({
                hostPort: hostPortList[i]
            }));
        }

        cb(null);
    }
};

TestClusterProxy.prototype.close = function close(cb) {
    var self = this;

    for (var i = 0; i < self.apps.length; i++) {
        self.apps[i].destroy();
    }

    self._clusterChild.close(cb);
};
