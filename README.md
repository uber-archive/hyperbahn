# hyperbahn

Service discovery and routing solution.

## Overview

Hyperbahn is a service discovery and routing network. Its aim is to simplify
reliably talking to any service without having to know where the service is
running.

Hyperbahn is an overlay network of routers designed to support the
[TChannel RPC protocol][tchannel]. Hyperbahn itself is a [ringpop][ringpop]
based mesh network of router nodes that dynamically converge and gossip known
services onto a consistent hash ring topology.

Hyperbahn and TChannel clients are currently supported
in Go, Python, and Node.js.

## Hyperbahn Features

Hyperbahn provides many scaling and fault tolerance features including:

 - timeouts to transitively enforce your service's SLA
 - retries to eliminate transient failures within a request timeout window
 - load balancing so that calls are spread out evenly across your service
 - rate limiting to shield your service from excessive calls
 - circuit breaking to prevent cascading failure
 - circuit breaking to cut off broken clients

To register a service on Hyperbahn:

 - instantiate Hyperbahn client
 - listen on an arbitrary (could be random) port
 - connect to and advertise on Hyperbahn

As a service consumer you get the following built in to TChannel/Hyperbahn
client libraries:

 - configuration discovery: no more host/port files or configuration to manage
 - timeouts: every request must specify a timeout, moving towards a fast
   failure model
 - load balancing: outgoing requests are spread evenly over connected Hyperbahn
   nodes
 - circuit breaking: fast failure at all layers of the network

To use a service over Hyperbahn:

 - instantiate Hyperbahn client (if you're also a service, you re-use the one
   you've already setup and registered over)
 - send a request to the desired service and endpoint name

## Local quickstart

 - `git clone git@github.com:uber/hyperbahn`
 - `cd hyperbahn`
 - `./hyperbahn-dev.sh`

This will spawn a 3 window tmux session with a two-node hyperbahn
cluster running. It will also run `npm install` if necessary and install
tcurl globally if possible and fallback to local installation if the npm
global folder is not writeable. The third window runs the health checks
of both nodes using tcurl to double check that the hyperbahn cluster is
healthy.

To exit run `tmux kill-session -t hyperbahn` in a seperate shell.

## Getting your app on Hyperbahn

We have an open source quick start template for nodejs.

 - `npm install tchannel-gen --global`
 - `cd ~/projects`
 - `tchannel-gen my-hyperbahn-app "A new hyperbahn app"`
 - `cd my-hyperbahn-app`
 - `npm install`
 - `make start`
 - `tcurl -p localhost:9000 my-service MyService::health_v1 -t ./thrift/service.thrift`
 - `tcurl -p 127.0.0.1:21300 my-service MyService::health_v1 -t ./thrift/service.thrift`

What this does is start a hello world tchannel app in nodejs that
registers with hyperbahn.

You can `tcurl` it directly at `localhost:9000` or `tcurl` it through
hyperbahn at `127.0.0.1:21300`.

Because the service is available on Hyperbahn anyone can talk to it
if they can talk to Hyperbahn.

## Installation

 - `npm install hyperbahn`

## Running the tests

 - `git clone git@github.com:uber/hyperbahn`
 - `cd hyperbahn`
 - `npm install`
 - `npm test`

# MIT Licenced

  [tchannel]: https://github.com/uber/tchannel
  [ringpop]: https://github.com/uber/ringpop-node
