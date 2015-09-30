# hyperbahn

Service discovery and routing solution.

## Overview

Hyperbahn is a service discovery and routing network. Its aim is to simplify 
reliably talking to any service without having to know where the service is 
running.

Hyperbahn is an overlay network of routers designed to support the 
[TChannel RPC protocol][tchannel].  Hyperbahn itself is a [ringpop][ringpop] 
based mesh network of router nodes that dynamically converge and gossip known
services onto a consistent hash ring topology.

Hyperbahn and TChannel clients are currently supported 
in Go, Python, and Node.js.

## Local quickstart

 - `git clone git@github.com:uber/hyperbahn`
 - `cd hyperbahn`
 - `npm install`
 - `npm install tcurl --global`
 - `./hyperbahn-dev.sh`

This will spawn a 3 window tmux session with a two-node hyperbahn
cluster running. The third window runs the health checks of both
nodes to double check that the hyperbahn cluster is healthy.

To exit run `tmux kill-session -t hyperbahn` in a seperate shell.

## Getting your app on Hyperbahn

We have an open source quick start template for nodejs.

 - `npm install`
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
