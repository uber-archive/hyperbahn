
# What?
Hyperbahn is the future vision of how services at Uber will perform **service discovery** and **routing**.

Let us unpack that a bit.  First let us discuss **service discovery**.  Uber has a service-oriented-architecture, breaking logical tasks into smaller independent services which call upon one another.  But that brings up a good question... If service A needs to call service B, it needs a mechanism to determine where (which hosts) service B is running and is in a healthy state.  This process is called service discovery.  On the internet, service discovery occurs using DNS.

**routing** is simply how a message is passed from one machine to another.  Today communication between services occurs with simple HTTP requests, but they jump through a proxy (HAProxy) which helps us load balance and ensure health.

# How?

![image](http://i.imgur.com/G2oc5l9.png)

* **TChannel** - The arrows above represent communication connections provided by TChannel which supports some nice features
  * **open source** - this is a project we have open sourced on github
  * **RPC protocol** - allows us to specify which service and method we wish to invoke remotely
  * **multiplexing** - over a single connection we can pass messages for different destinations (services)
  * **bi-directional** - requests and responses can flow in either direction
  * **reordering** - allows for out-of-order request/responses (vs. HTTP/1.0 with keep-alive for connection reuse, HTTP/1.1 with pipelining which suffers from head-of-line blocking)
* **Ringpop** - The circle of routers in the center are part of a Ringpop.
  * **open source** - this is a project we have open sourced on github
  * **distributed hash table** - each router/node in the ring is assigned ownership of a range of hashed results
  * **consistent hashing** - if a router/node is added or departs, very few (generally 1/n) of the hashed objects needs to be reassigned
  * **SWIM/Gossip protocol** - used between router/nodes in the ring for efficiently communicating any changes to the list of router/nodes in the ring
* **Hyperbahn** - The combination of TChannel and Ringpop
  * **egress affinity** - the exit router/node for a given service is agreed upon due to the DHT
  * New instances of a service will connect to Hyperbahn and register
  * Their well known exit (or egress) router/node will connect to them
  * Requests for that service will be routed to the well known egress node

# Devil in the Details

* **TChannel** - The [protocol doc for TChannel](https://github.com/uber/tchannel/blob/master/docs/protocol.md) is a great spot to get the gist of TChannel.  Certainly read the first few sections, but don't feel the need to read past the Framing section.  The open source project can be found on [github](https://github.com/uber/tchannel)
* **Ringpop** - The open source project can be found on [github](https://github.com/uber/ringpop)
* **Hyperbahn** - This [Hyperbahn overview doc](https://docs.google.com/document/d/15QzdFkGS4iWGko9v_h1NUOjED4Pk5bJMgGFf1TVyLf8/edit) is a good source of information
