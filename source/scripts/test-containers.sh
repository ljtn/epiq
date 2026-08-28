#!/usr/bin/env sh

# Runs the two docker suites at once. They do not share writable state: the
# collab container mounts the checkout read-only, and nothing it runs reads
# `dist`, which is what the e2e container rebuilds.
#
# Output is buffered per suite so a failure is readable rather than interleaved.

set -u

log_dir=$(mktemp -d)
trap 'rm -rf "$log_dir"' EXIT

npm run test:e2e >"$log_dir/e2e.log" 2>&1 &
e2e_pid=$!

npm run test:collab >"$log_dir/collab.log" 2>&1 &
collab_pid=$!

wait "$e2e_pid"
e2e_rc=$?

wait "$collab_pid"
collab_rc=$?

echo "--- e2e ---"
cat "$log_dir/e2e.log"
echo "--- collaboration ---"
cat "$log_dir/collab.log"

if [ "$e2e_rc" -ne 0 ] || [ "$collab_rc" -ne 0 ]; then
	exit 1
fi
