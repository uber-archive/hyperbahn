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

module.exports = RoutingBridge;

function RoutingBridge(routingWorker) {
    if (!(this instanceof RoutingBridge)) {
        return new RoutingBridge(routingWorker);
    }

    var self = this;

    self._routingWorker = routingWorker;
    self.draining = false;

}

RoutingBridge.prototype.listen = function listen(port, host, cb) {
    var self = this;

    self._routingWorker.tchannel.on('listening', onListening);
    self._routingWorker.tchannel.listen(port, host);

    function onListening() {
        cb(null, self._routingWorker.tchannel.hostPort);
    }
};

RoutingBridge.prototype.extendLogInfo = function extendLogInfo(info) {
    var self = this;

    return self._routingWorker.tchannel.extendLogInfo(info);
};

RoutingBridge.prototype.destroy = function destroy() {
    var self = this;

    if (!self._routingWorker.tchannel.destroyed) {
        self._routingWorker.tchannel.close();
    }
};

RoutingBridge.prototype.isDraining = function isDraining() {
    var self = this;

    return self._routingWorker.tchannel.draining;
};

RoutingBridge.prototype.drain = function drain(message, cb) {
    var self = this;

    return self._routingWorker.tchannel.drain(message, cb);
};

RoutingBridge.prototype.unsafeGetPeer =
function unsafeGetPeer(hostPort) {
    var self = this;

    return self._routingWorker.tchannel.peers.get(hostPort);
};

RoutingBridge.prototype.unsafeGetRateLimiter =
function unsafeGetRateLimiter(hostPort) {
    var self = this;

    return self._routingWorker.tchannel.handler.rateLimiter;
};
