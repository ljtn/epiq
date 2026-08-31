#!/usr/bin/env sh

# The pre-push gate. Nothing here shares state, so it all runs at once: lint,
# typecheck and the unit suite alongside one build feeding the docker suites and
# the GUI browser suite (the container stage skips rebuilding). Output is
# buffered per job so a failure is readable rather than interleaved.

set -u

BLUE='\033[0;34m'
GREEN='\033[0;32m'
NC='\033[0m'

log_dir=$(mktemp -d)
trap 'rm -rf "$log_dir"' EXIT

run() {
	name=$1
	shift
	"$@" >"$log_dir/$name.log" 2>&1
	echo $? >"$log_dir/$name.rc"
}

# Prints every job's output, then fails if any job did.
report() {
	failed=0

	for name in "$@"; do
		echo "--- $name ---"
		cat "$log_dir/$name.log"
		[ "$(cat "$log_dir/$name.rc")" -eq 0 ] || failed=1
	done

	return $failed
}

# The browser and container suites need the build; the checks on the left do
# not, so they overlap it and everything behind it.
checks() {
	run lint npm run lint:err &
	run typecheck npm run build &
	run test npm test &
	wait
}

suites() {
	if ! npm run build:npm >"$log_dir/build.log" 2>&1; then
		echo 1 >"$log_dir/build.rc"
		echo 1 >"$log_dir/containers.rc"
		echo 1 >"$log_dir/gui.rc"
		: >"$log_dir/containers.log"
		: >"$log_dir/gui.log"
		return
	fi
	echo 0 >"$log_dir/build.rc"

	EPIQ_SKIP_BUILD=1 run containers npm run test:containers &
	# Not `--no-shell`: headless Chromium runs as the headless shell, which that
	# flag is what skips downloading. It only ever passed here because a machine
	# that had run a plain `playwright install` already had one cached.
	run gui sh -c 'npx playwright install chromium && npx playwright test' &
	wait
}

echo "${BLUE}Running lint, typecheck, unit, e2e, collaboration and GUI browser tests...${NC}"
checks &
suites &
wait
report lint typecheck test build containers gui || exit 1

echo "${GREEN}Pre-push checks passed.${NC}"
