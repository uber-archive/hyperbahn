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

var test = require('tape');

var LevelRouterBackend = require('../../lib/larch/level-router-backend');
var Record = require('../../lib/larch/record');

var FakeBackend = require('../lib/fake-backend');

test('LevelRouterBackend correctly categorizes logs', function t1(assert) {
    var debugBackend = FakeBackend();
    var errorBackend = FakeBackend();
    var defaultBackend = FakeBackend();

    var levelRouter = LevelRouterBackend({
        backends: {
            debug: debugBackend,
            error: errorBackend,
            default: defaultBackend
        }
    });

    levelRouter.bootstrap(noop);

    levelRouter.log(new Record('error', 'error1', {}));
    levelRouter.log(new Record('error', 'error2', {}));
    levelRouter.log(new Record('debug', 'debug1', {}));
    levelRouter.log(new Record('debug', 'debug2', {}));
    levelRouter.log(new Record('info', 'info1', {}));
    levelRouter.log(new Record('info', 'info2', {}));

    assert.ok(debugBackend.logs.length === 2, 'debug backend got 2 logs');
    assert.ok(errorBackend.logs.length === 2, 'error backend got 2 logs');
    assert.ok(defaultBackend.logs.length === 2, 'default backend got 2 logs');

    assert.ok(
        debugBackend.logs[0].data.message === 'debug1',
        'debugBackend.logs[0] is correct'
    );
    assert.ok(
        debugBackend.logs[1].data.message === 'debug2',
        'debugBackend.logs[1] is correct'
    );

    assert.ok(
        errorBackend.logs[0].data.message === 'error1',
        'errorBackend.logs[0] is correct'
    );
    assert.ok(
        errorBackend.logs[1].data.message === 'error2',
        'errorBackend.logs[1] is correct'
    );

    assert.ok(
        defaultBackend.logs[0].data.message === 'info1',
        'defaultBackend.logs[0] is correct'
    );
    assert.ok(
        defaultBackend.logs[1].data.message === 'info2',
        'defaultBackend.logs[1] is correct'
    );

    assert.end();
});

function noop() {}
