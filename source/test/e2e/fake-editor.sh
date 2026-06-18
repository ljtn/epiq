#!/bin/sh
# Deterministic, non-interactive editor for e2e tests.
#
# `epiq` opens the configured editor on a temp file that holds the current
# field value and reads the file back afterwards. A real editor (vim) would
# block waiting for a human, so this stand-in just writes a fixed value and
# exits 0 so the `edit.description` event is produced deterministically.
printf 'Implemented during the e2e flow\n' > "$1"
