Hyperbahn
=========

Hyperbahn is a service discovery and routing network that allows simple, reliable
communication with any service without any knowledge of where that service runs.

Hyperbahn supports the TChannel RPC protocol and works with Ringpop's gossip protocol
and consistent hash ring topology.

Think of TChannel as the way to transport messages. Hyperbahn is the mesh that connects
all of the services trying to communicate. They rely on each other to form a robust,
sturdy network of smart interservice communication.

Clients are currently supported in Go, Node.js, and Python.
Learn how to get started with Hyperbahn by starting with the TChannel guides below:


* Go
    * [Guide](go-guide.md)
    * [API Documentation](https://godoc.org/github.com/uber/tchannel-go/hyperbahn)


* Node
    * [Guide](http://tchannel-node.readthedocs.org/en/latest/GUIDE/#creating-a-hyperbahn-client)
    * [API Documentation](http://tchannel-node.readthedocs.org/en/latest/)


* Python
    * [Guide](http://tchannel.readthedocs.org/projects/tchannel-python/en/latest/guide.html#hyperbahn)
    * [API Documenation](http://tchannel.readthedocs.org/projects/tchannel-python)
