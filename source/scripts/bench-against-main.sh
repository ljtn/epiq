#!/bin/sh
# Runs the stress benchmark on this checkout and on main, taking turns on the
# same board restored before each run, then fails on a substantial regression.
# Restored in place: the board's git worktrees record their absolute paths.
# Usage: bench-against-main.sh <stress dir> <main checkout> [runs]
set -u

board=$1
main=$2
runs=${3:-3}
head=$(pwd)
work=$(mktemp -d)
mkdir -p "$work/main" "$work/head"
cp -R "$board" "$work/pristine"

# The PR's benchmark, so both sides are timed the same way.
cp "$head/source/test/stress/bench.ts" "$main/source/test/stress/bench.ts"

bench() {
	side=$1
	dir=$2
	run=$3
	rm -rf "$board"
	cp -R "$work/pristine" "$board"
	(cd "$dir" && BENCH_DIR="$board" BENCH_OUT="$work/$side/$run.json" \
		NODE_OPTIONS=--max-old-space-size=4096 npx tsx source/test/stress/bench.ts) ||
		echo "  $side run $run failed"
}

i=1
while [ "$i" -le "$runs" ]; do
	bench main "$main" "$i"
	bench head "$head" "$i"
	i=$((i + 1))
done

npx tsx source/test/stress/compare-bench.ts "$work/main" "$work/head"
