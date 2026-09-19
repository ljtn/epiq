#!/usr/bin/env sh

# Runs the two docker suites at once. They do not share writable state: the
# collab container mounts the checkout read-only, and nothing it runs reads
# `dist`, which is what the e2e container rebuilds.
#
# Both cap their vitest workers (`test:e2e:ci`, `test:collab:ci`). A container
# sees every core, so uncapped they take one worker each while the gate is also
# running the unit suite and the browser suite on those same cores — and these
# tests wait on frames painted by a real pty, so contention reads as a timeout
# rather than as slowness. The caps are what make the gate survive a machine
# with more than one session on it.
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
