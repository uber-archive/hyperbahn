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

var TestCluster = require('./lib/test-cluster.js');

/* Test fail with confusing message if running server.js &
    tests at the same time.
*/

require('./endpoint-logging.js');

require('./admin/channels.js');
require('./admin/kill-switch.js');
require('./admin/rate-limiter.js');

require('./child-process/spawn-server.js');

require('./circuits/happy-path.js');
require('./circuits/circuits.js');

require('./clients/process-reporter.js');
require('./clients/statsd.js');
require('./clients/repl.js');
require('./clients/heap-dumps.js');
require('./clients/channel.js');

require('./connections/happy-path.js');
require('./connections/no-body.js');
require('./connections/missing-service-name.js');
require('./connections/invalid-service-name.js');

require('./forward/happy-path.js');
require('./forward/forwarding-to-down-server.js');
require('./forward/forwarding-to-non-existant-service.js');
require('./forward/forwarding-where-entry-node-is-exit-node.js');
require('./forward/forwarding-where-entry-node-is-not-exit-node.js');
require('./forward/thrift.js');
require('./forward/set-k.js');
require('./forward/forwarding-with-tiny-timeout.js');
require('./forward/forwarding-concurrently.js');
require('./forward/forwarding-req-defaults.js');
require('./forward/kill-switch.js');
require('./forward/forwarding-huge-buffer.js');
require('./forward/forwarding-respects-relay-flags.js');
require('./forward/forwarding-under-membershipchange-is-non-event.js');
require('./forward/dead-remote-reaped.js');
require('./forward/routing-delegate.js');
require('./forward/stats-for-rate-limited-requests.js');

require('./hosts/happy-path.js');
require('./hosts/no-body.js');
require('./hosts/missing-service-name.js');
require('./hosts/invalid-service-name.js');

require('./hyperbahn-client/kill-switch.js');
require('./hyperbahn-client/egress-nodes.js');

require('./hyperbahn-client/forward.js')(TestCluster);
require('./hyperbahn-client/advertise.js')(TestCluster);
require('./hyperbahn-client/unadvertise.js')(TestCluster);
require('./hyperbahn-client/hostports.js')(TestCluster);
require('./hyperbahn-client/forward-retry.js')(TestCluster);
require('./hyperbahn-client/hyperbahn-down.js')(TestCluster);
require('./hyperbahn-client/hyperbahn-times-out.js')(TestCluster);
require('./hyperbahn-client/rate-limiter.js')(TestCluster);
require('./hyperbahn-client/advertise-with-purge-interval.js')(TestCluster);
require('./hyperbahn-client/discover.js')(TestCluster);

require('./register/to-connected-node.js');
require('./register/with-ringpop-divergence.js');
require('./register/happy-path.js');
require('./register/validation-errors.js');
require('./register/register-where-entry-node-is-exit-node.js');
require('./register/register-when-exit-node-is-down.js');
require('./register/register-with-slow-affinity.js');

require('./time-series/making-requests-with-a-single-busy-hyperbahn-worker.js');
require('./time-series/requesting-a-service-with-spiky-traffic.js');

require('./trace.js');
require('./remote-config-client.js');
require('./remote-config.js');
require('./rate-limiter.js');
require('./sorted-index-of.js');
require('./partial-affinity.js');
require('./partial-range.js');
require('./peer-reaper-runs.js');
require('./peer-churn.js');
