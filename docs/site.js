/* Shared nav behaviour: the stamped version, read through a short-lived
 * localStorage cache so the nav paints immediately and the network is
 * skipped while the cache is fresh. */
(function () {
	"use strict";

	var TTL_MS = 10 * 60 * 1000;

	function cached(key, valid) {
		try {
			var obj = JSON.parse(localStorage.getItem(key));
			return obj && valid(obj) ? obj : null;
		} catch (e) {
			return null;
		}
	}

	function store(key, obj) {
		try {
			obj.ts = Date.now();
			localStorage.setItem(key, JSON.stringify(obj));
		} catch (e) {}
	}

	(function version() {
		var KEY = "epiq_version";
		// The same file the pre-push stamp reads, served by the raw CDN so it
		// costs nothing against the GitHub API rate limit.
		var SRC = "https://raw.githubusercontent.com/ljtn/epiq/main/source/version.ts";
		var outs = document.querySelectorAll(".nav-version");
		if (!outs.length) return;

		function render(v) {
			outs.forEach(function (out) {
				out.textContent = v;
			});
		}

		// The markup carries the stamped version as a fallback, so the nav
		// never renders empty while this resolves.
		var hit = cached(KEY, function (o) {
			return typeof o.version === "string";
		});
		if (hit) render(hit.version);
		if (hit && Date.now() - hit.ts < TTL_MS) return;

		fetch(SRC)
			.then(function (res) {
				return res.ok ? res.text() : null;
			})
			.then(function (text) {
				var found = text && /EPIQ_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(text);
				if (!found) return;
				render(found[1]);
				store(KEY, { version: found[1] });
			})
			.catch(function () {});
	})();

})();
