#!/usr/bin/env sh

# The stress harness under both cores, at three sizes, as one table: what the
# Rust core buys on a big board, measured rather than claimed.
#
# Opt-in and in no pipeline: the biggest size wants minutes and gigabytes.
#
#   npm run bench:core                      # 100k, 500k and 960k events
#   BENCH_SIZES="100000" npm run bench:core # one size, to see it work first
#   BENCH_HEAP=12288 npm run bench:core     # more heap for the biggest size
#
# Runs on this machine, not in the container: the stress script's container
# mounts the checkout read-only, and the point here is the pair of cores on
# one machine, side by side.

set -eu

SIZES="${BENCH_SIZES:-100000 500000 960000}"
HEAP="${BENCH_HEAP:-8192}"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/epiq-bench-XXXXXX")"
trap 'rm -rf "$ROOT"' EXIT

npm run build:rust >/dev/null 2>&1

# One row per stage the harness times, columns per (size, core).
STAGES="load, parse and order the log|replay it (materializeAll)|timeline, cold (builds the index)|timeline, warm (per request)|filing a ticket (the fixture’s reload)|filing a second (what a user feels)|peak rss"

printf '%-42s' 'stage'
for size in $SIZES; do
	for core in js rust; do
		printf '%14s' "${size}/${core}"
	done
done
printf '\n'

results="$ROOT/results"
mkdir -p "$results"

for size in $SIZES; do
	for core in js rust; do
		dir="$ROOT/$size-$core"
		mkdir -p "$dir"
		EPIQ_CORE="$core" STRESS_EVENTS="$size" STRESS_SERVE=false STRESS_DIR="$dir" \
			node --max-old-space-size="$HEAP" --import tsx source/test/stress/run.ts \
			>"$results/$size-$core.txt" 2>&1 || {
			echo "the $core core failed at $size events:" >&2
			tail -20 "$results/$size-$core.txt" >&2
			exit 1
		}
		rm -rf "$dir"
	done
done

echo "$STAGES" | tr '|' '\n' | while IFS= read -r stage; do
	printf '%-42s' "$stage"
	for size in $SIZES; do
		for core in js rust; do
			# The number and its unit, off the harness's own line.
			value=$(grep -F "$stage" "$results/$size-$core.txt" | head -1 |
				sed -E 's/^[^0-9]*([0-9.]+ (s|ms|MB)).*$/\1/')
			printf '%14s' "${value:-?}"
		done
	done
	printf '\n'
done
