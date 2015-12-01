SIZES=4096,16384
PIPELINE=10000,20000
BENCH_ARGS=--relay --skipPing -s ${SIZES} -p ${PIPELINE}

take-relay:
	node index.js --relay --noEndpointOverhead -o relay-$$(git rev-parse --short HEAD).json -- -m 3 ${BENCH_ARGS}
	ln -sf relay-$$(git rev-parse --short HEAD).json relay-$$(basename $$(git symbolic-ref HEAD)).json

torch-relay-bench:
	node index.js --relay --torch relay --torchFile ./flame.raw --torchTime 10 -- ${BENCH_ARGS}

take-relay-multi:
	node index.js --multi --relay --noEndpointOverhead -o relay-$$(git rev-parse --short HEAD).json -- -m 3 ${BENCH_ARGS}
	ln -sf relay-$$(git rev-parse --short HEAD).json relay-$$(basename $$(git symbolic-ref HEAD)).json

torch-relay-multi-bench:
	node index.js --multi --relay --torch relay --torchFile ./flame.raw --torchTime 10 -- ${BENCH_ARGS}

take-relay-bad:
	node index.js --bad --relay --noEndpointOverhead -o relay-$$(git rev-parse --short HEAD)-bad.json -- --bad -m 3 ${BENCH_ARGS}
	ln -sf relay-$$(git rev-parse --short HEAD)-bad.json relay-$$(basename $$(git symbolic-ref HEAD))-bad.json

torch-relay-bad-bench:
	node index.js --bad --relay --torch relay --torchFile ./flame.raw --torchTime 10 -- --bad ${BENCH_ARGS}

create-flame:
	stackcollapse-stap.pl ./flame.raw | tr -d "\0" > ./flame.folded
	flamegraph.pl ./flame.folded > ./flame.svg
	google-chrome ./flame.svg

kill-dead-benchmarks:
	pkill -f nodejs-benchmarks;

top-benchmark:
	top -d1 -cp `pgrep -f nodejs-benchmarks | tr "\\n" "," | sed 's/,$$//'`;

.PHONY: create-flame kill-dead-benchmarks top-benchmark
