/* Copy buttons: a .copy-cmd or .code-copy copies its data-copy and says
 * "Copied" for a moment. */
document.querySelectorAll(".copy-cmd, .code-copy").forEach(function (el) {
	el.addEventListener("click", function () {
		var cmd = el.getAttribute("data-copy") || "";
		var ico = el.querySelector(".copy-cmd-ico") || el;
		var label = ico.textContent;

		function done() {
			el.classList.add("copied");
			ico.textContent = "Copied";
			setTimeout(function () {
				el.classList.remove("copied");
				ico.textContent = label;
			}, 1600);
		}

		if (navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(cmd).then(done, fallback);
		} else {
			fallback();
		}

		function fallback() {
			var ta = document.createElement("textarea");
			ta.value = cmd;
			ta.style.position = "fixed";
			ta.style.opacity = "0";
			document.body.appendChild(ta);
			ta.select();
			try {
				document.execCommand("copy");
				done();
			} catch (e) {}
			document.body.removeChild(ta);
		}
	});
});
