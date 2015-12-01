SIZES=4096,16384
PIPELINE=100,200
BENCH_ARGS=--relay --skipPing -s ${SIZES} -p ${PIPELINE}
TAKE_RUN_ARGS=--relay --noEndpointOverhead
TORCH_RUN_ARGS=--relay --torch relay --torchFile ./flame.raw --torchTime 10

take-relay:
	node index.js ${TAKE_RUN_ARGS} -o relay-$$(git rev-parse --short HEAD).json -- -m 3 ${BENCH_ARGS}
	ln -sf relay-$$(git rev-parse --short HEAD).json relay-$$(basename $$(git symbolic-ref HEAD)).json

torch-relay-bench:
	node index.js ${TORCH_RUN_ARGS} -- ${BENCH_ARGS}

take-relay-multi:
	node index.js --multi ${TAKE_RUN_ARGS} -o relay-$$(git rev-parse --short HEAD).json -- -m 3 ${BENCH_ARGS}
	ln -sf relay-$$(git rev-parse --short HEAD).json relay-$$(basename $$(git symbolic-ref HEAD)).json

torch-relay-multi-bench:
	node index.js --multi ${TORCH_RUN_ARGS} -- ${BENCH_ARGS}

take-relay-bad:
	node index.js --bad ${TAKE_RUN_ARGS} -o relay-$$(git rev-parse --short HEAD)-bad.json -- --bad -m 3 ${BENCH_ARGS}
	ln -sf relay-$$(git rev-parse --short HEAD)-bad.json relay-$$(basename $$(git symbolic-ref HEAD))-bad.json

torch-relay-bad-bench:
	node index.js --bad ${TORCH_RUN_ARGS} -- --bad ${BENCH_ARGS}

%.folded: %.raw
	stackcollapse-stap.pl $< | tr -d "\0" > $@

create-flame: flame.folded
	flamegraph.pl $< > ./flame.svg
	google-chrome ./flame.svg

kill-dead-benchmarks:
	pkill -f nodejs-benchmarks;

top-benchmark:
	top -d1 -cp `pgrep -f nodejs-benchmarks | tr "\\n" "," | sed 's/,$$//'`;

.PHONY: create-flame kill-dead-benchmarks top-benchmark
