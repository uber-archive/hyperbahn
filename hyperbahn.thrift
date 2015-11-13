exception NoPeersAvailable {
    1: required string message
    2: required string serviceName
}

exception InvalidServiceName {
    1: required string message
    2: required string serviceName
}

exception InvalidInstanceHostPort {
    1: required string message
    2: required string instanceHostPort
}

exception NotAffineForServiceName {
    1: required string message
    2: required string serviceName
}

exception InvalidTimeToBan {
    1: required string message
    2: required i32 timeToBan
}

struct DiscoveryQuery {
    1: required string serviceName
}

union IpAddress {
    1: i32 ipv4
}

struct ServicePeer {
    1: required IpAddress ip
    2: required i32 port
}

struct DiscoveryResult {
    1: required list<ServicePeer> peers
}

struct BlackListQuery {
    1: required string serviceName
    2: required string instanceHostPort
    3: required i32 timeToBan
}

struct BlackListResult {
    1: required bool wasConnected
}

service Hyperbahn {
    DiscoveryResult discover(
        1: required DiscoveryQuery query
    ) throws (
        1: NoPeersAvailable noPeersAvailable
        2: InvalidServiceName invalidServiceName
    )

    /*  blacklist() only operates locally.

        It must be called on an affinity node and fanout
        is out of band for now.
    */
    BlackListResult blacklist(
        1: required BlackListQuery query
    ) throws (
        1: InvalidServiceName invalidServiceName
        2: InvalidInstanceHostPort invalidInstanceHostPort
        3: NotAffineForServiceName notAffineForServiceName
        4: InvalidTimeToBan invalidTimeToBan
    )
}
