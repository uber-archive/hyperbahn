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

var collectParallel = require('collect-parallel/array');
var CountedReadySignal = require('ready-signal/counted');
var timers = require('timers');
var util = require('util');

var Turnip = require('./lib/turnip').Turnip;
var Turnips = require('./lib/turnip').Turnips;
var allocCluster = require('./lib/test-cluster.js');
var CollapsedAssert = require('./lib/collapsed-assert.js');

/* eslint-disable no-multi-spaces */
var PERIOD              = 100;
var REQUEST_TIMEOUT     = 2 * PERIOD;
var REQUEST_FACTOR      = 1;
var SETTLE_PERIODS      = 10;
var CLUSTER_SIZE        = 10;
var CHURN_FACTOR        = 0.5;
var K_VALUE             = 5;
var SERVICE_SIZE        = 10;
var ENDPOINT_DELAY      = 0.5 * PERIOD;
var ENDPOINT_DELAY_FUZZ = 0.50;

function fuzzedPeriods(N) {
    return 1.05 * N * PERIOD;
}

allocCluster.test('peer churn', {
    size: CLUSTER_SIZE,
    noBob: true,
    noSteve: true,
    noTCollector: true,

    remoteConfig: {
        'kValue.services': {
            'lucy': K_VALUE
        },
        'peerConnecter.period': PERIOD,
        'peerPruner.period': PERIOD,
        'peerReaper.period': PERIOD
    },

    whitelist: [

        // XXX do we care about the rare:
        // AUTOBAHN INFO: ignoring outresponse.send on a closed connection ~ { responseId: 5,

        ['warn', 'affinity change failed audit'],
        ['warn', 'removing stale partial affinity worker'],

        ['info', 'reaping dead peers'],
        ['info', 'reaping dead peer'],
        ['info', 'draining peer'],

        ['error', 'Failed to register to hyperbahn for remote'],

        ['info', 'Peer drained and closed due to unadvertisement'],
        ['info', 'canceling peer drain'],
        ['info', 'draining pruned peer'],
        ['info', 'pruning peers'],
        ['info', 'stopping peer drain'],

        // XXX flappy logs but no harm
        ['warn', 'error while forwarding'],
        ['info', 'resetting connection']

    ]

}, function t(cluster, assert) {
    var serverOpts = {
        serviceName: 'lucy',
        registerEvery: 50
    };

    var clientOpts = {
        serviceName: 'kathy',
        registerEvery: 50
    };

    var client = cluster.createRemote(clientOpts, clientReady);
    var first = null;
    var second = null;
    var turnips = null;

    function clientReady() {
        assert.comment('- clientReady');
        checkAllLogs(cluster, assert, checkConnectingLog);
        first = createRemotes(cluster, SERVICE_SIZE, serverOpts, gotFirstRound);
    }

    function gotFirstRound() {
        assert.comment('- gotFirstRound');
        checkAllLogs(cluster, assert, checkConnectingLog);
        checkExitsTo(cluster, 'lucy', first, 'the first peers', assert);
        checkRequestsTo('lucy', first, 'the first peers', client.clientChannel, assert, setupSecondRound);
    }

    function setupSecondRound() {
        assert.comment('- setupSecondRound');
        checkAllLogs(cluster, assert, checkConnectingLog);
        second = createRemotes(cluster, Math.round(CHURN_FACTOR * first.length), serverOpts, gotSecondRound);
    }

    function gotSecondRound() {
        assert.comment('- gotSecondRound');
        checkAllLogs(cluster, assert, checkConnectingLog);
        checkExitsTo(cluster, 'lucy', second, 'the second peers', assert);
        checkRequestsTo('lucy', first.concat(second), 'either generation', client.clientChannel, assert, thenShutdownFirstRound);
    }

    function thenShutdownFirstRound() {
        assert.comment('- thenShutdownFirstRound');

        turnips = new Turnips();
        turnips.ready = new CountedReadySignal(first.length);

        collectParallel(first, function each(remote, i, done) {
            var hostPort = remote.channel.hostPort;
            var parts = hostPort.split(':');
            var host = parts[0];
            var port = parseInt(parts[1], 10);

            // half of them do an unad then destroy, the other half just go away
            if (i % 2 === 0) {
                remote.doUnregister(function unreged(err) {
                    assert.ifError(err, 'expected no unregister error');
                    remote.destroy(plant);
                });
            } else {
                remote.destroy(plant);
            }

            function plant() {
                assert.comment('-- planting turnip[' + i + '] on ' + hostPort);
                turnips.turnips[i] = new Turnip(port, host, ready);
                done();
            }

            function ready(err) {
                assert.comment('-- turnip[' + i + '] ready on ' + hostPort);
                assert.ifError(err, 'no unexpected turnip error');
                turnips.ready.signal();
            }
        }, thenWaitForReaper);
    }

    function thenWaitForReaper() {
        assert.comment('- thenWaitForReaper');

        timers.setTimeout(thenTurnip, fuzzedPeriods(SETTLE_PERIODS));
    }

    function thenTurnip() {
        assert.comment('- thenTurnip');

        checkAllLogs(cluster, assert, function checkEachLog(record) {
            assert.ok([
                // TODO: this is a bug parlayed into a warning
                'affinity change failed audit',
                'removing stale partial affinity worker',

                // happens for destructive shutdown
                'reaping dead peers',
                'Failed to register to hyperbahn for remote',
                'expected registration failure during destruction',
                'resetting connection',

                // these happen due to the unads
                'Peer drained and closed due to unadvertisement',
                'canceling peer drain',
                'draining peer',
                'implementing affinity change',
                'stopping peer drain',
                'pruning peers',

                // these happen more for the peers that didn't unad above
                'connecting peers',
                'resetting connection',
                'reaping dead peers',
                'reaping dead peer',
                'draining peer',
                'pruning peers'
            ].indexOf(record.msg) >= 0, 'expected peer churn logs');
        });

        turnips.ready(thenWaitAndSee);
    }

    function thenWaitAndSee() {
        assert.comment('- thenWaitAndSee');

        checkNoLogs('turnip', cluster, assert);

        timers.setTimeout(thenTendAndSend, fuzzedPeriods(SETTLE_PERIODS));
    }

    function thenTendAndSend() {
        assert.comment('- thenTendAndSend');
        checkNoLogs('turnip tending', cluster, assert);
        checkTurnips();
        sendAfterChurn();
    }

    function checkTurnips() {
        var logs = turnips.takeConnLogs();
        for (var i = 0; i < logs.length; ++i) {
            var log = logs[i];
            var turnip = turnips.turnips[i];
            assert.equal(log.length, 0, util.format(
                'expected no connections to turnip[%s] (%s)',
                i, turnip.hostPort
            ));
        }
    }

    function sendAfterChurn() {
        assert.comment('- sendAfterChurn');
        checkRequestsTo('lucy', second, 'the second peers', client.clientChannel, assert, thenDestroySecondRound);
    }

    function thenDestroySecondRound() {
        assert.comment('- thenDestroySecondRound');

        // XXX: these don't always happen, but when they do the client retries around them
        checkAllLogs(cluster, assert, function checkEachLog(record) {
            if (record.msg === 'error while forwarding') {
                var fields = record._logData.fields;
                assert.equal(fields.error.type, 'tchannel.connection.reset',
                    'expected connection reset while forwarding error');
            } else {
                assert.equal(record.msg, 'resetting connection',
                    'expected resetting connection log');
            }
        });

        checkTurnips();

        destroyAll(second.concat([turnips, client]), finish);
    }

    function finish() {
        assert.comment('- finish');
        assert.end();
    }
});

function checkConnectingLog(record, assert) {
    assert.ok([
        // XXX this is a sign of this test running too slowly for the given
        // parameters... but finding a balance where travis produces none of
        // them, while still running at useful parameters here is...
        // challenging
        'reaping dead peers',

        'connecting peers',
        'implementing affinity change'
    ].indexOf(record.msg) >= 0, 'expected connection logs due to peer advertise');
}

function destroyAll(destroyables, cb) {
    collectParallel(destroyables, destroyEach, cb);
}

function destroyEach(destroyable, i, done) {
    destroyable.destroy(done);
}

function createRemotes(cluster, N, opts, cb) {
    var done = CountedReadySignal(N);
    var res = [];
    for (var i = 0; i < N; ++i) {
        res[i] = cluster.createRemote(opts, done.signal);
        res[i].serverChannel.register('who', who);
    }
    done(cb);
    return res;
}

function who(req, res) {
    var delay = ENDPOINT_DELAY + 1 + (0.5 - Math.random()) * ENDPOINT_DELAY_FUZZ;
    timers.setTimeout(thenRespond, delay);

    function thenRespond() {
        res.headers.as = 'raw';
        res.sendOk(delay.toString(), req.channel.hostPort);
    }
}

function checkExitsTo(cluster, serviceName, cohort, desc, assert) {
    var cassert = CollapsedAssert();
    for (var i = 0; i < cohort.length; ++i) {
        var peer = cohort[i];
        cluster.checkExitPeers(cassert, {
            serviceName: serviceName,
            hostPort: peer.hostPort
        });
    }
    cassert.report(assert, 'expected exit peers for ' + desc);
}

/* eslint max-params: [2,8] */
function checkRequestsTo(serviceName, cohort, desc, chan, assert, cb) {
    var cassert = CollapsedAssert();
    sendMany(chan, REQUEST_FACTOR * cohort.length, {
        serviceName: serviceName,
        timeout: REQUEST_TIMEOUT
    }, 'who', '', '', function sent(err, res, arg2, arg3) {
        cassert.ifError(err, 'no unexpected check request error');
        var serverHostPort = String(arg3);
        cassert.ok(cohort.some(function isit(remote) {
            return remote.hostPort === serverHostPort;
        }), 'expected request to be served by one of ' + desc);
    }, function finish() {
        cassert.report(assert, 'expected requests to be served by ' + desc);
        cb();
    });
}

function sendMany(chan, N, opts, arg1, arg2, arg3, check, cb) {
    var sendsDone = CountedReadySignal(N);
    sendsDone(cb);
    for (var i = 0; i < sendsDone.counter; ++i) {
        timers.setImmediate(doRequest);
    }

    function doRequest() {
        chan.request(opts).send(arg1, arg2, arg3, done);
    }

    function done(err, res, resArg2, resArg3) {
        check(err, res, resArg2, resArg3);
        sendsDone.signal();
    }
}

function takeLogs(dbgLogtron) {
    var records = dbgLogtron._backend.records;
    dbgLogtron._backend.records = [];
    return records;
}

function checkAllLogs(cluster, assert, check) {
    var failed = false;
    assert.on('result', onResult);

    var records = takeLogs(cluster.logger);
    for (var i = 0; i < records.length; ++i) {
        var record = records[i];
        failed = false;
        check(record, assert);
        if (failed) {
            assert.comment(util.format(
                'UNEXPECTED LOG: %s %s: %j',
                record.levelName, record.msg, record._logData.fields
            ));
        }
    }
    assert.removeListener('result', onResult);

    function onResult(result) {
        if (!failed && typeof result === 'object') {
            failed = !result.ok;
        }
    }
}

function checkNoLogs(desc, cluster, assert) {
    var records = takeLogs(cluster.logger);
    assert.equal(records.length, 0, 'expected no logs from ' + desc);
    if (records.length) {
        for (var i = 0; i < records.length; ++i) {
            var record = records[i];
            assert.comment(util.format('UNEXPECTED LOG: %s %s: %j',
                record.levelName, record.msg, record._logData.fields
            ));
        }
    }
}
