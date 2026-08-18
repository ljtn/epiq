#!/usr/bin/env sh
#
# Stamps the docs nav with the version from source/version.ts on `main`.
#
# The nav's releases link shows the latest version and refreshes itself from the
# same file at runtime; the stamped value is what visitors see before (or
# instead of) that fetch. It only has to be correct at deploy time, so this runs
# on pre-push rather than being maintained by hand.
#
# Usage: sh scripts/stamp-version.sh
# Exits 1 when it rewrote a file — commit the result, then push again.

set -e

cd "$(dirname "$0")/.."

PAGES="docs/index.html docs/docs.html docs/blog.html docs/releases.html"

if ! git fetch -q origin main 2>/dev/null; then
	echo "stamp-version: can't reach origin, leaving the stamped version alone."
	exit 0
fi

VERSION=$(git show origin/main:source/version.ts |
	sed -n "s/.*EPIQ_VERSION = '\([^']*\)'.*/\1/p")

if [ -z "$VERSION" ]; then
	echo "stamp-version: no EPIQ_VERSION found in origin/main:source/version.ts"
	exit 1
fi

CHANGED=""
for f in $PAGES; do
	current=$(sed -n 's/.*<span class="nav-version">\([^<]*\)<\/span>.*/\1/p' "$f" | head -1)
	if [ -z "$current" ]; then
		echo "stamp-version: no .nav-version span in $f"
		exit 1
	fi
	[ "$current" = "$VERSION" ] && continue
	perl -0pi -e \
		"s{<span class=\"nav-version\">[^<]*</span>}{<span class=\"nav-version\">$VERSION</span>}g" \
		"$f"
	CHANGED="$CHANGED $f"
done

if [ -n "$CHANGED" ]; then
	echo "stamp-version: updated nav to v$VERSION in$CHANGED"
	echo "Commit the change, then push again."
	exit 1
fi

exit 0
