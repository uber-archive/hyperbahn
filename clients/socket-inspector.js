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

var Socket = require('net').Socket;
var socketEmit = Socket.prototype.emit;

var assert = require('assert');
var WrappedError = require('error/wrapped');

var UnexpectedSocketError = WrappedError({
    type: 'unexpected-socket-error',
    message: 'Got unexpected socket error: {causeMessage}'
});

module.exports = SocketInspector;

function SocketInspector(opts) {
    if (!(this instanceof SocketInspector)) {
        return new SocketInspector(opts);
    }

    var self = this;

    assert(opts.logger, 'logger required');
    self.logger = opts.logger;

    self.enabled = false;
    self.boundInspectEmit = boundInspectEmit;

    function boundInspectEmit() {
        // pass this=socket & arguments=args to inspector
        self.inspectEmit(this, arguments);
    }
}

SocketInspector.prototype.enable = function enable() {
    var self = this;

    if (self.enabled) {
        return;
    }

    Socket.prototype.emit = self.boundInspectEmit;
};

SocketInspector.prototype.disable = function disable() {
    var self = this;

    if (!self.enabled) {
        return;
    }

    Socket.prototype.emit = socketEmit;
};

SocketInspector.prototype.inspectEmit =
function inspectEmit(socket, args) {
    var self = this;

    var type = args[0];
    if (type === 'error' && (
        !socket._events.error ||
        (typeof socket._events.error === 'object' &&
            !socket._events.error.length)
    )) {
        var originalError = args[1];
        var error = UnexpectedSocketError(originalError);

        var info = {
            error: error,
            remoteAddr: socket.address(),
            readEnded: socket._readableState.ended,
            writeEnded: socket._writableState.ended,
            dataListenerName: null,
            dataListenerSource: null,
            closeListenerName: null,
            closeListenerSource: null,
            readBufferHead: null,
            writeBufferHead: null,
            writeBufferHeadCallbackName: null,
            writeBufferHeadCallbackSource: null
        };

        var dataListener = getFirstListener(socket, 'data');
        if (dataListener) {
            info.dataListenerName = dataListener.name;
            info.dataListenerSource = dataListener.toString().slice(0, 64);
        }

        var closeListener = getFirstListener(socket, 'close');
        if (closeListener) {
            info.closeListenerName = closeListener.name;
            info.closeListenerSource = closeListener.toString().slice(0, 64);
        }

        if (socket._readableState.buffer.length) {
            var buf = socket._readableState.buffer[0];
            info.readBufferHead = buf ? buf.toString('hex') : null;
        }

        if (socket._writableState.buffer.length) {
            var entry = socket._writableState.buffer[0];
            info.writeBufferHead = entry ? entry.buffer.toString('hex') : null;
            info.writeBufferHeadCallbackSource = entry ?
                entry.callback.toString().slice(0, 64) : null;
            info.writeBufferHeadCallbackName = entry ?
                entry.callback.name : null;
        }

        self.logger.error('socket emitted error but no listener', info);
    }

    return socketEmit.apply(socket, args);
};

function getFirstListener(object, eventName) {
    var value = object._events[eventName];
    if (!value) {
        return null;
    }

    if (typeof value === 'function') {
        return value;
    } else if (typeof value === 'object') {
        return value.length === 0 ? null : value[0];
    }
}
