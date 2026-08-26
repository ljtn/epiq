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

	// Only same-origin or plain http(s) targets are allowed through, so a
	// crafted "javascript:" or "data:" URL can never become a live src/href.
	function safeUrl(url) {
		return /^https?:\/\//.test(url) || /^#/.test(url) || /^\.{0,2}\//.test(url);
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

		// Images: rendered when opts.images is on, otherwise reduced to alt text.
		s = s.replace(
			/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
			function (_, alt, url) {
				if (!opts.images || !safeUrl(url)) return alt;
				return shield(
					'<img src="' + url + '" alt="' + alt + '" loading="lazy" decoding="async" />'
				);
			}
		);

		// Explicit links, with optional "title".
		s = s.replace(
			/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
			function (_, text, url) {
				if (!safeUrl(url) || !opts.links) return text;
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

	// Block-level rendering: headings, lists (nested ul/ol), tables,
	// blockquotes, fenced code, horizontal rules, paragraphs.
	function render(text, options) {
		var opts = {
			links: !options || options.links !== false,
			// Render images as <img> rather than reducing them to alt text.
			images: !!(options && options.images),
			// Base heading tag, e.g. 3 -> <h3>.
			heading: (options && options.heading) || 3,
			// Keep the source's heading depth, offset from `heading`, instead of
			// flattening every heading to the same tag.
			levels: !!(options && options.levels),
		};

		// With `levels`, `heading` is the shallowest tag a post may use: the
		// source's depth is kept but clamped, so "#" and "##" both land on it
		// and no level is ever skipped.
		function headingTag(hashes) {
			if (!opts.levels) return "h" + opts.heading;
			return "h" + Math.min(6, Math.max(opts.heading, hashes.length));
		}

		var lines = esc(String(text).replace(/\r\n/g, "\n")).split("\n");

		var html = "";
		var para = [];
		var quote = [];
		var inCode = false;
		var code = [];
		var codeLang = "";
		// One frame per open list level, innermost last.
		var stack = [];
		var itemBuf = [];

		// Marks a hard line break (a line ending in two spaces). It is appended
		// before the text is trimmed, and survives the join below.
		var BR = String.fromCharCode(1);

		function joinLines(buf) {
			return buf
				.join(" ")
				.split(BR + " ")
				.join("<br />")
				.split(BR)
				.join("");
		}

		function flushPara() {
			if (para.length) {
				html += "<p>" + inline(joinLines(para), opts) + "</p>";
				para = [];
			}
		}
		function flushQuote() {
			if (quote.length) {
				html +=
					"<blockquote><p>" +
					inline(joinLines(quote), opts) +
					"</p></blockquote>";
				quote = [];
			}
		}
		function flushCode() {
			var cls = codeLang ? ' class="lang-' + codeLang + '"' : "";
			html +=
				'<pre class="code"><code' + cls + ">" + code.join("\n") + "</code></pre>";
			code = [];
			codeLang = "";
			inCode = false;
		}

		// Writes the buffered text of the current item, leaving its <li> open so
		// a nested list can be emitted inside it.
		function flushItem() {
			if (!itemBuf.length) return;
			var frame = stack[stack.length - 1];
			html += "<li>" + inline(joinLines(itemBuf), opts);
			frame.itemOpen = true;
			itemBuf = [];
		}
		function closeItem() {
			var frame = stack[stack.length - 1];
			if (frame && frame.itemOpen) {
				html += "</li>";
				frame.itemOpen = false;
			}
		}
		function openList(type, indent) {
			html += "<" + type + ">";
			stack.push({ type: type, indent: indent, itemOpen: false });
		}
		function closeList() {
			closeItem();
			html += "</" + stack.pop().type + ">";
		}
		function closeLists(indent) {
			flushItem();
			while (stack.length && stack[stack.length - 1].indent > indent) closeList();
		}
		function closeAllLists() {
			flushItem();
			while (stack.length) closeList();
		}
		function flushAll() {
			flushPara();
			closeAllLists();
			flushQuote();
		}

		var TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

		function splitRow(row) {
			return row
				.trim()
				.replace(/^\|/, "")
				.replace(/\|$/, "")
				.split("|")
				.map(function (c) {
					return c.trim();
				});
		}

		function renderTable(head, aligns, rows) {
			function cell(tag, text, i) {
				var a = aligns[i];
				return (
					"<" +
					tag +
					(a ? ' style="text-align:' + a + '"' : "") +
					">" +
					inline(text, opts) +
					"</" +
					tag +
					">"
				);
			}
			var out = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
			out += head
				.map(function (c, i) {
					return cell("th", c, i);
				})
				.join("");
			out += "</tr></thead><tbody>";
			out += rows
				.map(function (r) {
					return (
						"<tr>" +
						r
							.map(function (c, i) {
								return cell("td", c, i);
							})
							.join("") +
						"</tr>"
					);
				})
				.join("");
			return out + "</tbody></table></div>";
		}

		for (var i = 0; i < lines.length; i++) {
			var line = lines[i];

			if (inCode) {
				if (/^\s*```/.test(line)) flushCode();
				else code.push(line);
				continue;
			}

			var hardBreak = /\s\s$/.test(line);
			var t = line.trim();
			var m;

			if (/^```/.test(t)) {
				flushAll();
				codeLang = (t.slice(3).trim().match(/^[\w+-]+/) || [""])[0];
				inCode = true;
				continue;
			}

			if (!t) {
				// A blank line ends a paragraph or quote, but a list survives it:
				// the next item continues the same list (a "loose" list).
				flushPara();
				flushQuote();
				if (stack.length) flushItem();
				continue;
			}

			// A table is only a table if the next line is its divider row, so this
			// is checked before anything else a pipe-bearing line could be.
			if (
				t.indexOf("|") !== -1 &&
				i + 1 < lines.length &&
				lines[i + 1].indexOf("|") !== -1 &&
				TABLE_DIVIDER.test(lines[i + 1])
			) {
				flushAll();
				var head = splitRow(t);
				var aligns = splitRow(lines[i + 1]).map(function (c) {
					if (/^:-+:$/.test(c)) return "center";
					if (/^:-+$/.test(c)) return "left";
					if (/^-+:$/.test(c)) return "right";
					return "";
				});
				var rows = [];
				i += 2;
				while (
					i < lines.length &&
					lines[i].trim() &&
					lines[i].indexOf("|") !== -1
				) {
					rows.push(splitRow(lines[i].trim()));
					i++;
				}
				i--;
				html += renderTable(head, aligns, rows);
				continue;
			}

			if ((m = t.match(/^(#{1,6})\s+(.*)$/))) {
				flushAll();
				var hTag = headingTag(m[1]);
				html += "<" + hTag + ">" + inline(m[2], opts) + "</" + hTag + ">";
				continue;
			}

			if (
				opts.images &&
				(m = t.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)$/)) &&
				safeUrl(m[2])
			) {
				// A picture on its own line becomes a figure, with the alt text
				// doubling as the caption.
				flushAll();
				html +=
					'<figure class="md-figure"><img src="' +
					m[2] +
					'" alt="' +
					m[1] +
					'" loading="lazy" decoding="async" />' +
					(m[1] ? "<figcaption>" + m[1] + "</figcaption>" : "") +
					"</figure>";
				continue;
			}

			if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) {
				flushAll();
				html += "<hr />";
				continue;
			}

			if ((m = t.match(/^&gt;\s?(.*)$/))) {
				flushPara();
				closeAllLists();
				quote.push(m[1] + (hardBreak ? BR : ""));
				continue;
			}

			var bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
			var ordered = line.match(/^(\s*)\d+[.)]\s+(.*)$/);
			if (bullet || ordered) {
				m = bullet || ordered;
				var type = bullet ? "ul" : "ol";
				var indent = m[1].length;
				flushPara();
				flushQuote();

				if (!stack.length) {
					openList(type, indent);
				} else if (indent > stack[stack.length - 1].indent) {
					flushItem();
					openList(type, indent);
				} else {
					closeLists(indent);
					var top = stack[stack.length - 1];
					if (!top) {
						openList(type, indent);
					} else if (top.type !== type) {
						closeList();
						openList(type, indent);
					} else {
						closeItem();
					}
				}
				itemBuf.push(m[2].replace(/\s+$/, "") + (hardBreak ? BR : ""));
				continue;
			}

			// An indented line under a list item continues that item's text.
			if (stack.length && /^\s+/.test(line) && itemBuf.length) {
				itemBuf.push(t + (hardBreak ? BR : ""));
				continue;
			}

			closeAllLists();
			flushQuote();
			para.push(t + (hardBreak ? BR : ""));
		}

		if (inCode) flushCode();
		flushAll();
		return html;
	}

	return { render: render, esc: esc };
})();
