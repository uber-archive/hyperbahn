take-%: results/%.json
	echo "Done $< -> $$(readlink -f $<)"

torch-%: results/%.svg
	echo "Done $< -> $$(readlink -f $<)"

results/%.json: results/HEAD/%.json
	ln -sf $$(readlink -f $<) $@

results/%.raw: results/HEAD/%.raw
	ln -sf $$(readlink -f $<) $@

results/HEAD:
	mkdir -p results/$$(git rev-parse --short HEAD)
	ln -nsf $$(git rev-parse --short HEAD) results/$$(basename $$(git symbolic-ref HEAD))
	ln -nsf $$(basename $$(git symbolic-ref HEAD)) results/HEAD

results/HEAD/%.json: config/%.json results/HEAD kill-dead-benchmarks
	BENCH_CONFIG=$<,config/take.json node index.js -o $@

results/HEAD/%.raw: config/%.json results/HEAD kill-dead-benchmarks
	BENCH_CONFIG=$<,config/torch.json node index.js --torchFile $@

%.folded: %.raw
	stackcollapse-stap.pl $< | tr -d "\0" > $@

%.svg: %.folded
	flamegraph.pl $< > $@

kill-dead-benchmarks:
	pkill -f '^nodejs-benchmarks' || true

top-benchmark:
	top -d1 -cp `pgrep -f nodejs-benchmarks | tr "\\n" "," | sed 's/,$$//'`;

.PRECIOUS: results/%.json results/HEAD/%.json results/%.raw results/HEAD/%.raw

.PHONY: results/HEAD create-flame kill-dead-benchmarks top-benchmark
