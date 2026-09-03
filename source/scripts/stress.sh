#!/usr/bin/env sh

# Ten years of a twenty-person board, generated and replayed in a container,
# then served so it can be used rather than only measured.
#
# Opt-in, and deliberately in no pipeline: it takes minutes and wants gigabytes.
#
#   npm run stress                     # the default: ~960k events, serves the GUI
#   STRESS_EVENTS=50000 npm run stress # something smaller, to see it work first
#   STRESS_SERVE=false npm run stress  # numbers only, exits when done
#
# A container so it neither touches the real board nor depends on this machine
# having the right node. The image is the e2e one, which already carries git and
# the dependencies.

set -eu

# What the browser on this machine opens. Inside the container the GUI binds
# 3710 on loopback — its own design — so socat bridges the two: it cannot
# listen on 3710 itself, since 0.0.0.0 covers loopback and node would then find
# the port taken and quietly move to another one.
PORT="${STRESS_PORT:-3720}"
GUI_PORT=3710

SERVE="${STRESS_SERVE:-true}"
MEMORY="${STRESS_MEMORY:-6g}"
# Node's default heap is well under what a million events needs, and it dies
# with a stack trace that looks like a bug in the board rather than a limit.
NODE_HEAP="${STRESS_NODE_HEAP:-5120}"

# The checkout goes in read-only, so anything the run needs built has to be
# built out here.
if [ ! -f dist/gui/index.html ]; then
	echo "Building the GUI (the container mounts this read-only)..."
	npm run build:gui
fi

if ! docker image inspect epiq-e2e >/dev/null 2>&1; then
	echo "Building the epiq-e2e image (once)..."
	npm run build:e2e:image
fi

echo "Stress board in a container — memory ${MEMORY}, GUI on http://127.0.0.1:${PORT}"

# A terminal only when there is one to attach: run from a script or a pipe,
# `-t` fails outright with "the input device is not a TTY".
if [ -t 0 ]; then
	TTY_FLAGS="-it"
else
	TTY_FLAGS=""
fi

# `--init` so ctrl-c reaches node rather than leaving it holding the port.
# shellcheck disable=SC2086
exec docker run --rm ${TTY_FLAGS} --init \
	--memory "${MEMORY}" \
	-p "${PORT}:${PORT}" \
	-e STRESS_EVENTS="${STRESS_EVENTS:-}" \
	-e STRESS_ACTORS="${STRESS_ACTORS:-}" \
	-e STRESS_YEARS="${STRESS_YEARS:-}" \
	-e STRESS_SERVE="${SERVE}" \
	-e NODE_OPTIONS="--max-old-space-size=${NODE_HEAP}" \
	-v "$PWD":/app:ro \
	-v /app/node_modules \
	-w /app \
	epiq-e2e \
	sh -c "
		if [ '${SERVE}' = 'true' ]; then
			apt-get update >/dev/null 2>&1
			apt-get install -y socat >/dev/null 2>&1
			socat TCP-LISTEN:${PORT},fork,reuseaddr TCP:127.0.0.1:${GUI_PORT} &
		fi
		npx tsx source/test/stress/run.ts
	"
