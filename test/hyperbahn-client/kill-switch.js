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

var BlockingTable = require('../../router/blocking-table.js');

test('set cn/service', function t(assert) {
    var blockingTable = new BlockingTable();

    assert.equals(blockingTable._blockingTable, null, 'blocking table should be null');
    blockingTable.block('client1', 'service1');
    blockingTable.block('client1', 'service2');
    blockingTable.block('client2', 'service1');
    blockingTable.block('*', 'service1');
    blockingTable.block(null, 'service2');

    assert.ok(blockingTable.isBlocked('client1', 'service1'), 'set blocking client1/service1 correctly');
    assert.ok(blockingTable.isBlocked('client1', 'service2'), 'set blocking client1/service2 correctly');
    assert.ok(blockingTable.isBlocked('client2', 'service1'), 'set blocking client2/service1 correctly');
    assert.ok(blockingTable.isBlocked('*', 'service1'), 'set blocking */service1 correctly');
    assert.ok(blockingTable.isBlocked('*', 'service2'), 'set blocking */service2 correctly');
    assert.notOk(blockingTable.isBlocked('*', 'service3'), 'shouldn\'t have set */service3');
    assert.notOk(blockingTable.isBlocked('c', 's'), 'shouldn\'t have set c/s');

    assert.end();
});

test('clear cn/service', function t(assert) {
    var blockingTable = new BlockingTable();

    assert.equals(blockingTable._blockingTable, null, 'blocking table should be null');
    blockingTable.block('client1', 'service1');
    blockingTable.block('client1', 'service2');
    blockingTable.block('client2', 'service1');
    blockingTable.block('*', 'service1');
    blockingTable.block(null, 'service2');

    blockingTable.unblock('client1', 'service1');
    blockingTable.unblock('client2', 'service1');
    blockingTable.unblock('*', 'service1');

    assert.notOk(blockingTable.isBlocked('client1', 'service1'), 'client1/service1 should be cleared');
    assert.notOk(blockingTable.isBlocked('client2', 'service1'), 'client2/service1  should be cleared');
    assert.notOk(blockingTable.isBlocked('*', 'service1'), '*/service1  should be cleared');

    assert.ok(blockingTable.isBlocked('client1', 'service2'), 'client1/service2 shouldn\'t be cleared');
    assert.ok(blockingTable.isBlocked('*', 'service2'), 'blocking */service2 shouldn\'t be cleared');

    blockingTable.unblock('client1', 'service2');
    blockingTable.unblock(null, 'service2');
    assert.notOk(blockingTable.isBlocked('client1', 'service2'), 'client1/service2 should be cleared');
    assert.notOk(blockingTable.isBlocked('*', 'service2'), 'blocking */service2 should be cleared');
    assert.equals(blockingTable._blockingTable, null, 'blocking table should be cleared');

    assert.end();
});
