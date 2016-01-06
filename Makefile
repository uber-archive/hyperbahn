PUBLIC_IP=$(shell node scripts/public-ip.js)

# Helper for running autobahn servers locally.
run-local-%:
	node server.js --port `expr 21300 + $*` --bootstrapFile='["127.0.0.1:21300","127.0.0.1:21301"]' | jq .

run-staging-%:
	node server.js --host $(PUBLIC_IP) --port `expr 21300 + $*` --bootstrapFile='["$(PUBLIC_IP):21300", "$(PUBLIC_IP):21301", "$(PUBLIC_IP):21302", "$(PUBLIC_IP):21303", "$(PUBLIC_IP):21304"]' | jq .
