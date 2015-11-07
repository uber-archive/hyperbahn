# Hyperbahn

Service discovery and routing for large-scale microservice operations

* IRC: #hyperbahn on Freenode
* Questions: Open a [Github issue][issues]
* Uber's [OSS website][oss]


## Overview

Hyperbahn enables service discovery and routing for large-scale systems
comprised of many microservices. Distributed, fault tolerant, and highly
available, it lets one service find and communicate with others simply and
reliably without having to know where those services run.

Hyperbahn is an overlay network of routers designed to support the
[TChannel RPC protocol][tchannel]. Hyperbahn itself is based on
[Ringpop][ringpop]. Its router nodes dynamically converge and gossip
known services onto a consistent hash ring topology, forming a
mesh of services that can send requests to each other without human
intervention or knowledge of specific ports and addresses.

Hyperbahn and TChannel clients are currently supported
in Go, Python, and Node.js.

## Hyperbahn Features

Whether you're making your service available to others or you're a service
consumer, Hyperbahn comes with many features to make application development easier:

 - **Configuration Discovery** - Free yourself from managing host/port files or
   configurations.
 - **Timeouts** - Transitively enforce services' SLAs. Every request
   must specify a timeout, moving towards a fast failure model.
 - **Retries** - Eliminate transient failures within a request timeout window.
 - **Load Balancing** - Spread calls evenly across a service, and distribute outgoing
   requests evenly over connected Hyperbahn nodes.
 - **Rate Limiting** - Shield services from excessive calls.
 - **Circuit Breaking** - Prevent cascading failure and cut off broken clients. Build
   fast failure into all layers of the network.
 - **Distributed Tracing** - Understand the entire call flow using Zipkin.


## Advertise on a Hyperbahn Cluster

Register a service on Hyperbahn in just three steps:

 1. Instantiate Hyperbahn client
 2. Listen on an arbitrary (could be random) port
 3. Connect to and advertise on Hyperbahn

Or use a service over Hyperbahn in only two steps:

 1. Instantiate Hyperbahn client (if the client is also a service, you reuse the one
   you've already setup and registered over)
 2. Send a request to the desired service and endpoint name

## Local Quick Start

Hyperbahn is designed for large-scale microservice operations. However, you
might want to develop and test (or just try it out) locally.
To get started with Hyperbahn, set up a Hyperbahn cluster on your local machine.

 1. `git clone git@github.com:uber/hyperbahn`
 2. `cd hyperbahn`
 3. `./hyperbahn-dev.sh`

You'll now have a two-node Hyperbahn cluster running. In one of the tmux
windows, you should see the health checks of both nodes. Double check that the
Hyperbahn cluster is healthy. If not, troubleshoot or report your issue.

To exit, run `tmux kill-session -t hyperbahn` in a seperate shell.

## Getting Your App on Hyperbahn

The open source quick start template for Node.js (below) will start
a "Hello, world!" TChannel app in Node.js that registers with Hyperbahn.

 - `npm install tchannel-gen --global`
 - `cd ~/projects`
 - `tchannel-gen my-hyperbahn-app "A new hyperbahn app"`
 - `cd my-hyperbahn-app`
 - `npm install`
 - `make start`
 - `tcurl -p localhost:9000 my-service MyService::health_v1 -t ./thrift/service.thrift`
 - `tcurl -p 127.0.0.1:21300 my-service MyService::health_v1 -t ./thrift/service.thrift`

You can `tcurl` it directly at `localhost:9000` or `tcurl` it through
Hyperbahn at `127.0.0.1:21300`. If you're unfamiliar with `tcurl`, the
command-line tool to call TChannel servers, learn about it [here][tcurl].

Once a service is available on Hyperbahn, any other service on that Hyperbahn
cluster can talk to it.

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
  [issues]: https://github.com/uber/hyperbahn/issues
  [oss]: http://uber.github.io/
  [tcurl]: https://github.com/uber/tcurl
