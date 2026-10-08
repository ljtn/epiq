/* The GUI's swimlane border light: edges brighten under the pointer and fade
 * in as it approaches. Each element gets --gx/--gy (pointer, element-relative;
 * the nav's from its bottom edge, the only one it lights) and --gp (0 beyond
 * REACH_PX, up to NEAR_MAX approaching, 1 on the element). */
(function () {
	"use strict";

	var REACH_PX = 150;
	var NEAR_MAX = 0.5;
	var SAMPLE_MS = 16;

	if (!window.matchMedia("(hover: hover)").matches) return;

	var els = document.querySelectorAll(".nav, .copy-cmd, .hero-cta");
	var last = 0;

	window.addEventListener("mousemove", function (event) {
		var now = Date.now();
		if (now - last < SAMPLE_MS) return;
		last = now;

		for (var i = 0; i < els.length; i++) {
			var rect = els[i].getBoundingClientRect();
			var dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
			var dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
			var distance = Math.hypot(dx, dy);
			var style = els[i].style;
			style.setProperty("--gx", event.clientX - rect.left + "px");
			var edge = els[i].classList.contains("nav") ? rect.bottom : rect.top;
			style.setProperty("--gy", event.clientY - edge + "px");
			// Full strength only on the element, so of two adjacent boxes the
			// hovered one stands out.
			var near = distance >= REACH_PX ? 0 : NEAR_MAX * (1 - distance / REACH_PX);
			style.setProperty("--gp", distance === 0 ? 1 : near);
		}
	});
})();
