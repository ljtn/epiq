#!/bin/sh
# Deterministic editor stand-in that writes a description longer and wider than
# the box can hold, so the rows below and to the right of it have to be cut.
i=1
: > "$1"
while [ "$i" -le 30 ]; do
	printf 'line %s: %s\n' "$i" "the quick brown fox jumps over the lazy dog and keeps on running well past the right hand edge of the box" >> "$1"
	i=$((i + 1))
done
