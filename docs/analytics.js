/* Visitor stats.
 *
 * Off until SITE is filled in — until then this file does nothing at all.
 *
 * GitHub Pages keeps no logs, so counting visitors needs a beacon in the page.
 * Pick a provider, create the site in its dashboard, paste the id below:
 *
 *   goatcounter  free for personal use, no cookies, no consent banner needed.
 *                Sign up at goatcounter.com; SITE is your subdomain code, so
 *                for "epiq.goatcounter.com" set SITE = "epiq".
 *
 *   plausible    paid, EU-hosted, no cookies. SITE is the domain you added,
 *                e.g. "ljtn.github.io".
 *
 *   cloudflare   free, no cookies. SITE is the token from the Web Analytics
 *                dashboard.
 *
 * All three are cookieless and store no personal data, which is why no consent
 * banner is wired up here. Adding a cookie-based tracker later would change
 * that.
 */
(function () {
	"use strict";

	var PROVIDER = "goatcounter"; // "goatcounter" | "plausible" | "cloudflare"
	var SITE = ""; // ← paste your site id here to switch stats on

	if (!SITE) return;

	// Local previews and file:// opens shouldn't land in the numbers.
	var host = location.hostname;
	if (!host || host === "localhost" || host === "127.0.0.1" || host === "[::1]") {
		return;
	}

	var s = document.createElement("script");
	s.async = true;

	if (PROVIDER === "goatcounter") {
		s.src = "https://gc.zgo.at/count.js";
		s.setAttribute("data-goatcounter", "https://" + SITE + ".goatcounter.com/count");
	} else if (PROVIDER === "plausible") {
		s.src = "https://plausible.io/js/script.js";
		s.setAttribute("data-domain", SITE);
	} else if (PROVIDER === "cloudflare") {
		s.src = "https://static.cloudflareinsights.com/beacon.min.js";
		s.setAttribute("data-cf-beacon", JSON.stringify({ token: SITE }));
	} else {
		return;
	}

	document.head.appendChild(s);
})();
