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

var InstanceBlackList = require('./instance-black-list.js');

module.exports = HyperbahnService;

function HyperbahnService(options) {
    if (!(this instanceof HyperbahnService)) {
        return new HyperbahnService(options);
    }

    var self = this;

    // TODO assert that channel === root channel
    // TODO assert that we assign serviceProxy before creating HyperbahnHandler()
    self.channel = options.channel;
    self.egressNodes = options.egressNodes;
    self.serviceProxy = self.channel.handler;

    self.instanceBlackList = new InstanceBlackList({
        channel: self.channel
    });

    // TODO: listen to egressNodes and fanout to re-blacklist ?
}

HyperbahnService.prototype.blacklist =
function blacklist(req, headers, body, cb) {
    var self = this;

    // TODO: validate body.serviceName
    // TODO: validate body.instanceHostPort
    // TODO: validate body.timeToBan
    // TODO: check that we are affine for serviceName

    self.instanceBlackList.blacklist(
        body.query.serviceName,
        body.query.instanceHostPort,
        body.query.timeToBan
    );

    // TODO ask serviceProxy to drain & purge peer.

    return cb(null, {
        ok: true,
        body: {
            // Get information from serviceProxy
            wasConnected: false
        }
    });
};
