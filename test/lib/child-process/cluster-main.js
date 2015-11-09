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

require('leaked-handles');

var parseArgs = require('minimist');
var process = require('process');
var console = require('console');

var TestCluster = require('./test-cluster.js');

if (require.main === module) {
    main(parseArgs(process.argv.slice(2)));
}

function main(argv) {
    /*eslint no-console: 0, no-process-exit: 0 */
    var args = new ClusterArgs(argv);

    var cluster = new TestCluster({
        size: args.size
    });

    process.on('message', onMessage);

    cluster.bootstrap(onBootstrap);

    function onBootstrap(err) {
        if (err) {
            console.error('Could not bootstrap HyperbahnTestCluster', {
                error: err
            });
            process.exit(1);
            return;
        }

        process.send({
            command: 'bootstrapComplete',
            hostPortList: cluster.hostPortList
        });
    }

    function onMessage(message) {
        if (message.command === 'close') {
            cluster.close(onClusterClose);
        }
    }

    function onClusterClose(err) {
        if (err) {
            console.error('Could not close HyperbahnTestCluster', {
                error: err
            });
            process.exit(1);
            return;
        }

        process.send({
            command: 'closeComplete'
        });
    }
}

function ClusterArgs(argv) {
    var self = this;

    self.size = argv.size;
}
