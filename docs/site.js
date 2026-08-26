/* Shared nav behaviour: the stamped version and the GitHub star count.
 * Both read through a short-lived localStorage cache so the nav paints
 * immediately and the network is skipped while the cache is fresh. */
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

	(function stars() {
		var KEY = "epiq_gh_stars";
		var buttons = document.querySelectorAll(".github-stars");
		if (!buttons.length) return;

		function formatCount(n) {
			if (n < 1000) return String(n);
			var x = n / 1000;
			// Truncate (like GitHub): one decimal under 100, whole above.
			return (x < 100 ? Math.floor(x * 10) / 10 : Math.floor(x)) + "k";
		}

		function render(count) {
			var label = formatCount(Number(count));
			buttons.forEach(function (btn) {
				var wrap = btn.querySelector(".stars");
				var out = btn.querySelector(".star-count");
				if (out) out.textContent = label;
				if (wrap) wrap.hidden = false;
			});
		}

		// Paint any cached value first to avoid layout shift.
		var hit = cached(KEY, function (o) {
			return typeof o.count === "number";
		});
		if (hit) render(hit.count);
		if (hit && Date.now() - hit.ts < TTL_MS) return;

		fetch("https://api.github.com/repos/ljtn/epiq", {
			headers: { Accept: "application/vnd.github+json" },
		})
			.then(function (res) {
				return res.ok ? res.json() : null;
			})
			.then(function (data) {
				if (data && typeof data.stargazers_count === "number") {
					render(data.stargazers_count);
					store(KEY, { count: data.stargazers_count });
				}
			})
			.catch(function () {});
	})();
})();
