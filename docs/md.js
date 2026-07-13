/* Minimal, safe markdown renderer for release notes and blog previews.
 * All input is HTML-escaped before any transform, so markup in the source
 * can never reach the DOM as live HTML. */
window.epiqMd = (function () {
	"use strict";

	function esc(s) {
		return String(s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	// Inline transforms run on escaped text. Code spans and finished anchors
	// are shielded behind placeholder tokens so later passes can't mangle
	// their contents.
	function inline(s, opts) {
		var shielded = [];
		function shield(html) {
			shielded.push(html);
			return "\u0000" + (shielded.length - 1) + "\u0000";
		}

		s = s.replace(/`([^`]+)`/g, function (_, c) {
			return shield("<code>" + c + "</code>");
		});

		// Images: keep the alt text only.
		s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, "$1");

		// Explicit links, with optional "title".
		s = s.replace(
			/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
			function (_, text, url) {
				var safe = /^https?:\/\//.test(url) || /^#/.test(url) || /^\.?\//.test(url);
				if (!safe || !opts.links) return text;
				return shield(
					'<a class="inline-link" href="' + url + '" rel="noopener">' + text + "</a>"
				);
			}
		);

		// Autolink bare URLs.
		if (opts.links) {
			s = s.replace(
				/(^|[\s(])(https?:\/\/[^\s<\u0000]*[^\s<\u0000.,;:!?)])/g,
				function (_, pre, url) {
					return (
						pre +
						shield('<a class="inline-link" href="' + url + '" rel="noopener">' + url + "</a>")
					);
				}
			);
		}

		// Emphasis: triple markers first, then bold, then italic.
		s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
		s = s.replace(/___([^_]+)___/g, "<strong><em>$1</em></strong>");
		s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
		s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
		s = s.replace(
			/(^|[\s>([\u0000])\*([^*\s][^*]*)\*(?=$|[\s<.,;:!?)\]\u0000])/g,
			"$1<em>$2</em>"
		);
		s = s.replace(
			/(^|[\s>([\u0000])_([^_\s][^_]*)_(?=$|[\s<.,;:!?)\]\u0000])/g,
			"$1<em>$2</em>"
		);
		s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");

		return s.replace(/\u0000(\d+)\u0000/g, function (_, i) {
			return shielded[+i];
		});
	}

	// Block-level rendering: headings, lists (ul/ol), blockquotes, fenced
	// code, horizontal rules, paragraphs.
	function render(text, options) {
		var opts = {
			links: !options || options.links !== false,
			// Tag used for every heading in the source, e.g. 3 -> <h3>.
			heading: (options && options.heading) || 3,
		};
		var hTag = "h" + opts.heading;
		var lines = esc(String(text).replace(/\r\n/g, "\n")).split("\n");

		var html = "";
		var para = [];
		var list = null; // "ul" | "ol" | null
		var quote = [];
		var inCode = false;
		var code = [];

		function flushPara() {
			if (para.length) {
				html += "<p>" + inline(para.join(" "), opts) + "</p>";
				para = [];
			}
		}
		function closeList() {
			if (list) {
				html += "</" + list + ">";
				list = null;
			}
		}
		function flushQuote() {
			if (quote.length) {
				html +=
					"<blockquote><p>" + inline(quote.join(" "), opts) + "</p></blockquote>";
				quote = [];
			}
		}
		function flushCode() {
			html += '<pre class="code"><code>' + code.join("\n") + "</code></pre>";
			code = [];
			inCode = false;
		}
		function flushAll() {
			flushPara();
			closeList();
			flushQuote();
		}

		lines.forEach(function (line) {
			if (inCode) {
				if (/^```/.test(line.trim())) flushCode();
				else code.push(line);
				return;
			}

			var t = line.trim();
			var m;

			if (/^```/.test(t)) {
				flushAll();
				inCode = true;
			} else if (!t) {
				flushAll();
			} else if ((m = t.match(/^#{1,6}\s+(.*)$/))) {
				flushAll();
				html += "<" + hTag + ">" + inline(m[1], opts) + "</" + hTag + ">";
			} else if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) {
				flushAll();
				html += "<hr />";
			} else if ((m = t.match(/^&gt;\s?(.*)$/))) {
				flushPara();
				closeList();
				quote.push(m[1]);
			} else if ((m = t.match(/^[-*+]\s+(.*)$/))) {
				flushPara();
				flushQuote();
				if (list !== "ul") {
					closeList();
					html += "<ul>";
					list = "ul";
				}
				html += "<li>" + inline(m[1], opts) + "</li>";
			} else if ((m = t.match(/^\d+[.)]\s+(.*)$/))) {
				flushPara();
				flushQuote();
				if (list !== "ol") {
					closeList();
					html += "<ol>";
					list = "ol";
				}
				html += "<li>" + inline(m[1], opts) + "</li>";
			} else {
				closeList();
				flushQuote();
				para.push(t);
			}
		});

		if (inCode) flushCode();
		flushAll();
		return html;
	}

	return { render: render, esc: esc };
})();
