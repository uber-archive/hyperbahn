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
var inherits = require('util').inherits;
var EventEmitter = require('tchannel/lib/event_emitter');
var sortedIndexOf = require('./lib/sorted-index-of');

module.exports = EgressNodes;

function EgressNodes(options) {
    if (!(this instanceof EgressNodes)) {
        return new EgressNodes(options);
    }
    var self = this;

    assert(options && options.defaultKValue, 'defaultKValue required');

    EventEmitter.call(self);

    self.ringpop = null;
    self.defaultKValue = options.defaultKValue;

    self.kValueForServiceName = Object.create(null);
    self.affinePeers = Object.create(null);

    // Surface the membership changed event (for use in particular by service
    // proxies).
    self.membershipChangedEvent = self.defineEvent('membershipChanged');
}

inherits(EgressNodes, EventEmitter);

EgressNodes.prototype.setRingpop = function setRingpop(ringpop) {
    var self = this;

    assert(self.ringpop === null, 'EgressNodes#setRingpop called twice');

    self.ringpop = ringpop;

    self.ringpop.on('membershipChanged', onMembershipChanged);
    function onMembershipChanged() {
        self.onMembershipChanged();
    }
};

EgressNodes.prototype.onMembershipChanged = function onMembershipChanged() {
    var self = this;

    // Invalidate cached affine peers
    self.affinePeers = Object.create(null);

    // TODO alternately incrementally update affine peers based on e.added,
    // e.removed of ringChanged.

    self.membershipChangedEvent.emit(self);
};

EgressNodes.prototype.kValueFor = function kValueFor(serviceName) {
    var self = this;
    return self.kValueForServiceName[serviceName] ||
        self.defaultKValue;
};

EgressNodes.prototype.setDefaultKValue = function setDefaultKValue(kValue) {
    var self = this;
    assert(typeof kValue === 'number' && kValue > 0, 'kValue must be positive: ' + kValue);
    self.defaultKValue = kValue;
};

EgressNodes.prototype.setKValueFor = function setKValueFor(serviceName, k) {
    var self = this;
    self.kValueForServiceName[serviceName] = k;
};

EgressNodes.prototype.getAffinePeers = function getAffinePeers(serviceName) {
    var self = this;

    var affinePeers = self.affinePeers[serviceName];
    if (!affinePeers) {
        affinePeers = self.computeAffinePeers(serviceName);
        self.affinePeers[serviceName] = affinePeers;
    }
    return affinePeers;
};

EgressNodes.prototype.computeAffinePeers = function computeAffinePeers(serviceName) {
    var self = this;

    assert(
        self.ringpop !== null,
        'EgressNodes#exitsFor cannot be called before EgressNodes has ' +
            ' ringpop set'
    );

    // Unique peers are retained in sorted order
    var peers = [];
    var k = self.kValueFor(serviceName);
    for (var i = 0; i < k; i++) {
        var shardKey = serviceName + '~' + i;
        var peer = self.ringpop.lookup(shardKey);
        var j = sortedIndexOf(peers, peer);
        if (j < 0) {
            peers.splice(~j, 0, peer);
        }
    }

    return peers;
};

EgressNodes.prototype.exitsFor = function exitsFor(serviceName) {
    var self = this;

    assert(
        self.ringpop !== null,
        'EgressNodes#exitsFor cannot be called before EgressNodes has ' +
            ' ringpop set'
    );

    var k = self.kValueFor(serviceName);
    // Object<hostPort: String, Array<lookupKey: String>>
    var exitNodes = Object.create(null);
    for (var i = 0; i < k; i++) {
        var shardKey = serviceName + '~' + i;

        // TODO ringpop will return itself if it cannot find
        // it which is probably the wrong semantics.
        var node = self.ringpop.lookup(shardKey);

        // TODO ringpop can return duplicates. do we want
        // <= k exitNodes or k exitNodes ?
        // TODO consider walking the ring instead.

        exitNodes[node] = exitNodes[node] || [];
        exitNodes[node].push(shardKey);
    }
    return exitNodes;
};

EgressNodes.prototype.isExitFor = function isExitFor(serviceName) {
    var self = this;

    assert(
        self.ringpop !== null,
        'EgressNodes#isExitFor cannot be called before EgressNodes has ' +
            ' ringpop set'
    );

    var k = self.kValueFor(serviceName);
    var me = self.ringpop.whoami();
    for (var i = 0; i < k; i++) {
        var shardKey = serviceName + '~' + i;
        var node = self.ringpop.lookup(shardKey);
        if (me === node) {
            return true;
        }
    }
    return false;
};
