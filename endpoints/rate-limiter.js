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

var TypedError = require('error/typed');

var InvalidBodyType = TypedError({
    type: 'hyperbahn.rate-limiter.invalid-body-type',
    message: 'Invalid body type',
    bodyType: null
});

var InvalidRequest = TypedError({
    type: 'hyperbahn.rate-limiter.invalid-request',
    message: 'Invalid request parameters',
    requestType: null
});

var DEFAULT_TOTAL_RPS_LIMIT = 1000;

module.exports.queryHandler = queryHandler;
module.exports.exemptHandler = exemptHandler;
module.exports.limitHandler = limitHandler;
module.exports.enableHandler = enableHandler;
module.exports.totalLimitHandler = totalLimitHandler;

function queryHandler(opts, req, head, body, cb) {
    var routingBridge = opts.worker.routingBridge;

    routingBridge.getRateLimiterInfo(onInfo);

    function onInfo(err, info) {
        if (err) {
            return cb(null, {
                ok: false,
                head: null,
                body: err
            });
        }

        cb(null, {
            ok: true,
            head: null,
            body: info
        });
    }
}

function exemptHandler(opts, req, head, body, cb) {
    var routingBridge = opts.worker.routingBridge;

    if (!body) {
        return cb(null, {
            ok: false,
            head: null,
            body: InvalidBodyType({
                bodyType: null
            })
        });
    }

    if (body.type === 'add' && typeof body.exemptService === 'string') {
        routingBridge.addRateLimitExceptService(body.exemptService);
    } else if (body.type === 'remove' && typeof body.exemptService === 'string') {
        routingBridge.removeRateLimitExceptService(body.exemptService);
    } else {
        return cb(null, {
            ok: false,
            head: null,
            body: InvalidRequest({
                requestType: 'exempt services'
            })
        });
    }

    return cb(null, {
        ok: true,
        head: null,
        body: null
    });
}

function limitHandler(opts, req, head, body, cb) {
    /*eslint complexity: 0*/
    var routingBridge = opts.worker.routingBridge;

    if (!body) {
        return cb(null, {
            ok: false,
            head: null,
            body: InvalidBodyType({
                bodyType: null
            })
        });
    }

    if (typeof body.serviceName === 'string' && typeof body.limit === 'number') {
        routingBridge.updateServiceRateLimit(body.serviceName, body.limit);
    } else if (typeof body.serviceName === 'string') {
        routingBridge.updateServiceRateLimit(body.serviceName, 'default');
    } else {
        return cb(null, {
            ok: false,
            head: null,
            body: InvalidRequest({
                requestType: 'service RPS limit'
            })
        });
    }

    return cb(null, {
        ok: true,
        head: null,
        body: null
    });
}

function enableHandler(opts, req, head, body, cb) {
    var routingBridge = opts.worker.routingBridge;

    if (!body) {
        return cb(null, {
            ok: false,
            head: null,
            body: InvalidBodyType({
                bodyType: null
            })
        });
    }

    if (body.type === 'enable') {
        routingBridge.toggleRateLimiter(true);
    } else if (body.type === 'disable') {
        routingBridge.toggleRateLimiter(false);
    } else {
        return cb(null, {
            ok: false,
            head: null,
            body: InvalidRequest({
                requestType: 'enable/disable'
            })
        });
    }

    return cb(null, {
        ok: true,
        head: null,
        body: null
    });
}

function totalLimitHandler(opts, req, head, body, cb) {
    var routingBridge = opts.worker.routingBridge;

    if (body && typeof body.limit === 'number') {
        routingBridge.updateTotalRateLimit(body.limit);
    } else {
        routingBridge.updateTotalRateLimit(DEFAULT_TOTAL_RPS_LIMIT);
    }

    return cb(null, {
        ok: true,
        head: null,
        body: null
    });
}
