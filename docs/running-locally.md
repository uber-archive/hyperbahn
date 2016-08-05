## Running hyperbahn locally

Please run the open source version of hyperbahn

```
git clone git@github.com:uber/hyperbahn
cd hyperbahn
./hyperbahn-dev.sh
```

To run hyperbahn you can use the tmux helper file to spin up two copies of hyperbahn.
The first instance runs on 21300. The second instance runs on 21301

They will configure and create a ring of two processes and both will succeed.

To verify you started it locally please install tcurl

```
npm i tcurl --global
tcurl -p 127.0.0.1:21300 autobahn health_v1
```

You can now configure your application with a seedList of
["127.0.0.1:21300", "127.0.0.1:21301"] and it will be able to advertise
to hyperbahn. Check the language specific guide on how to configure the
autobahn seed list.

Once you advertise to it you can `tcurl -p 127.0.0.1:21300 {my_service} {my_endpoint}`
