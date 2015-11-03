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

var remoteConfigFile = require('./lib/remote-config-file.js')();

var MAX_TIME = 50;

test('creating a RemoteConfig', function t(assert) {
    remoteConfigFile.clear();
    var config = remoteConfigFile.create();
    config.loadSync();

    assert.equal(config.get('unknown', '~na~'), '~na~');

    assert.end();
});

test('will fetch config file', function t(assert) {
    var config = remoteConfigFile.create();

    remoteConfigFile.write({
        'foo': 'bar'
    });

    config.loadSync();
    assert.equal(config.get('foo', '~na~'), 'bar');
    assert.end();
});

test('will allow namespaces', function t(assert) {
    var config = remoteConfigFile.create();

    remoteConfigFile.write({
        'foo.bar.baz': 'bar'
    });

    config.loadSync();
    assert.equal(config.get('foo.bar.baz', '~na~'), 'bar');
    assert.end();
});

test('will update on starting up', function t(assert) {
    assert.timeoutAfter(MAX_TIME);

    remoteConfigFile.clear();
    var config = remoteConfigFile.create({
        pollInterval: 5
    });

    config.on('change:foo', function onUpdate() {
        assert.equals(config.get('foo', '~na~'), 'bar', 'property should have been updated');
        assert.pass('the update event should have been emitted');
        config.destroy();
        assert.end();
    });

    remoteConfigFile.write({
        'foo': 'bar'
    });

    config.startPolling();
});

test('will alert on property change', function t(assert) {
    assert.timeoutAfter(MAX_TIME);

    remoteConfigFile.clear();
    var config = remoteConfigFile.create({
        pollInterval: 5
    });
    var before = config.get('foo', '~na~');
    config.on('change:foo', function onUpdate() {
        assert.notEquals(before, config.get('foo', '~na~'), 'property should have been updated');
        assert.pass('the update event should have been emitted');
        config.destroy();
        assert.end();
    });

    config.startPolling();

    remoteConfigFile.write({
        'foo': 'baz'
    });
});
