#!/usr/bin/env node
/* The blog build.
 *
 *   npm run build:blog              build once
 *   npm run blog:watch              rebuild whenever a post changes
 *   npm run blog:serve              watch + preview on :8777
 *   npm run blog:new -- "Title"     scaffold a new post
 *
 * Posts live in content/posts/*.md. Everything under docs/blog/ is generated —
 * never edit it by hand. Only `title` and `date` are required in a post's
 * frontmatter; the slug, description, reading time and cover are derived.
 */

import {
	readFileSync,
	writeFileSync,
	readdirSync,
	mkdirSync,
	copyFileSync,
	existsSync,
	rmSync,
	statSync,
	watch,
} from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const POSTS_DIR = join(root, "content/posts");
const IMAGES_DIR = join(POSTS_DIR, "images");
const DOCS = join(root, "docs");
const OUT_DIR = join(DOCS, "blog");
const BASE_URL = "https://ljtn.github.io/epiq";
const AUTHOR = "Jonatan Lampa";

/* The nav version is stamped onto the hand-written pages by
 * scripts/stamp-version.sh on pre-push. Generated pages read it back from
 * index.html so that rebuilding never reverts that stamp. */
const NAV_VERSION = (() => {
	const index = readFileSync(join(DOCS, "index.html"), "utf8");
	const found = /<span class="nav-version">([^<]*)<\/span>/.exec(index);
	if (!found) throw new Error("docs/index.html has no .nav-version span to read");
	return found[1];
})();

// Reuse the renderer the site already ships, so posts and release notes are
// formatted by exactly the same code.
const sandbox = {};
new Function("window", readFileSync(join(DOCS, "md.js"), "utf8"))(sandbox);
const md = sandbox.epiqMd;
const esc = md.esc;

const IMAGE_EXTS = [".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg"];

/* ---------- reading posts ---------- */

function slugify(s) {
	return String(s)
		.toLowerCase()
		.replace(/['’]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

function stripMarkdown(s) {
	return s
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/`([^`]*)`/g, "$1")
		.replace(/[*_~#>]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/* First real paragraph, trimmed to a sentence boundary where possible. */
function deriveDescription(body, limit = 158) {
	const para = body
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.find((p) => p && !/^(#|!\[|\{%|>|```|\||[-*+]\s|\d+[.)]\s)/.test(p));
	const text = stripMarkdown(para || "");
	if (text.length <= limit) return text;
	const cut = text.slice(0, limit);
	for (const sep of [". ", "! ", "? "]) {
		const i = cut.lastIndexOf(sep);
		if (i > limit * 0.5) return cut.slice(0, i + 1).trim();
	}
	return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:—-]$/, "") + "…";
}

function deriveReadingTime(body) {
	const words = stripMarkdown(body).split(/\s+/).filter(Boolean).length;
	// 275 wpm, rounded up — the rate dev.to used, so existing posts keep their
	// published reading times.
	return Math.max(1, Math.ceil(words / 275));
}

/* Any image in content/posts/images named after the post becomes its cover. */
function findCover(slug) {
	for (const ext of IMAGE_EXTS) {
		if (existsSync(join(IMAGES_DIR, slug + ext))) return `./images/${slug}${ext}`;
	}
	return "";
}

function parsePost(file) {
	const path = join(POSTS_DIR, file);
	const raw = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
	if (!match) {
		throw new Error(`${file}: needs a "---" frontmatter block at the top`);
	}

	const meta = {};
	for (const line of match[1].split("\n")) {
		if (!line.trim() || line.trim().startsWith("#")) continue;
		const at = line.indexOf(":");
		if (at === -1) throw new Error(`${file}: bad frontmatter line: ${line}`);
		meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
	}

	const body = match[2].trim();
	const slug = meta.slug || slugify(basename(file, ".md"));

	if (!meta.title) throw new Error(`${file}: frontmatter needs a "title"`);
	if (!meta.date) throw new Error(`${file}: frontmatter needs a "date" (YYYY-MM-DD)`);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date)) {
		throw new Error(`${file}: date must be YYYY-MM-DD, got "${meta.date}"`);
	}
	if (!body) throw new Error(`${file}: has no content below the frontmatter`);

	return {
		...meta,
		slug,
		body,
		draft: /^(true|yes)$/i.test(meta.draft || ""),
		tags: (meta.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
		description: meta.description || deriveDescription(body),
		readingTime: Number(meta.reading_time) || deriveReadingTime(body),
		cover: meta.cover || findCover(slug),
		coverAlt: meta.cover_alt || "",
	};
}

/* ---------- rendering ---------- */

function fmtDate(iso) {
	return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

function metaLine(post) {
	const parts = [fmtDate(post.date)];
	if (post.readingTime) parts.push(`${post.readingTime} min read`);
	if (post.draft) parts.push("draft");
	return parts.join("  ·  ");
}

function tagList(post) {
	if (!post.tags.length) return "";
	const tags = post.tags
		.map((t) => `<span class="post-tag">#${esc(t)}</span>`)
		.join("");
	return `<div class="post-tags">${tags}</div>`;
}

/* The chrome every page shares. `depth` is the path back to docs/, so pages
 * inside docs/blog/ resolve assets one level up. */
function shell({ title, description, canonical, image, depth, head = "", body }) {
	const up = depth ? "../" : "./";
	return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${esc(title)}</title>

		<meta name="description" content="${esc(description)}" />
		<meta name="theme-color" content="#090a0f" />
		<link rel="canonical" href="${esc(canonical)}" />

		<meta property="og:title" content="${esc(title)}" />
		<meta property="og:description" content="${esc(description)}" />
		<meta property="og:url" content="${esc(canonical)}" />
		<meta property="og:image" content="${esc(image)}" />
		<meta name="twitter:card" content="summary_large_image" />
${head}
		<link rel="icon" href="${up}favicon.ico" sizes="any" />
		<link rel="stylesheet" href="${up}styles.css" />
	</head>
	<body>
		<nav class="nav">
			<div class="wrap nav-inner">
				<a class="brand" href="${up}index.html" aria-label="Epiq home">
					<span><span class="accent">:</span>epiq</span>
				</a>
				<div class="links">
					<a class="cmd-link" href="${up}docs.html" aria-label="Documentation"
						><span class="accent">:</span>docs</a
					>
					<a
						class="cmd-link active"
						href="${up}blog.html"
						aria-label="Blog"
						><span class="accent">:</span>blog</a
					>
					<a class="cmd-link" href="${up}releases.html" aria-label="Releases"
						><span class="accent">v</span><span class="nav-version">${NAV_VERSION}</span></a
					>
					<a
						class="btn github-stars"
						href="https://github.com/ljtn/epiq"
						aria-label="Epiq on GitHub"
					>
						<span>GitHub</span>
						<span class="stars" hidden>
							<svg
								class="star-ico"
								viewBox="0 0 24 24"
								width="14"
								height="14"
								aria-hidden="true"
								focusable="false"
							>
								<path
									d="M9.15316 5.40838C10.4198 3.13613 11.0531 2 12 2C12.9469 2 13.5802 3.13612 14.8468 5.40837L15.1745 5.99623C15.5345 6.64193 15.7144 6.96479 15.9951 7.17781C16.2757 7.39083 16.6251 7.4699 17.3241 7.62805L17.9605 7.77203C20.4201 8.32856 21.65 8.60682 21.9426 9.54773C22.2352 10.4886 21.3968 11.4691 19.7199 13.4299L19.2861 13.9372C18.8096 14.4944 18.5713 14.773 18.4641 15.1177C18.357 15.4624 18.393 15.8341 18.465 16.5776L18.5306 17.2544C18.7841 19.8706 18.9109 21.1787 18.1449 21.7602C17.3788 22.3417 16.2273 21.8115 13.9243 20.7512L13.3285 20.4768C12.6741 20.1755 12.3469 20.0248 12 20.0248C11.6531 20.0248 11.3259 20.1755 10.6715 20.4768L10.0757 20.7512C7.77268 21.8115 6.62118 22.3417 5.85515 21.7602C5.08912 21.1787 5.21588 19.8706 5.4694 17.2544L5.53498 16.5776C5.60703 15.8341 5.64305 15.4624 5.53586 15.1177C5.42868 14.773 5.19043 14.4944 4.71392 13.9372L4.2801 13.4299C2.60325 11.4691 1.76482 10.4886 2.05742 9.54773C2.35002 8.60682 3.57986 8.32856 6.03954 7.77203L6.67589 7.62805C7.37485 7.4699 7.72433 7.39083 8.00494 7.17781C8.28555 6.96479 8.46553 6.64194 8.82547 5.99623L9.15316 5.40838Z"
									fill="currentColor"
								/>
							</svg>
							<span class="star-count"></span>
						</span>
					</a>
				</div>
			</div>
		</nav>

${body}

		<footer class="footer">
			<div class="wrap footer-inner">
				<div><code>:wq</code> and move on.</div>
			</div>
		</footer>

		<script src="${up}site.js"></script>
		<script src="${up}analytics.js"></script>
	</body>
</html>
`;
}

function renderIndex(posts) {
	const cards = posts
		.map((p) => {
			const href = `./blog/${esc(p.slug)}.html`;
			const cover = p.cover
				? `<a class="post-cover" href="${href}" tabindex="-1" aria-hidden="true">
							<img src="./blog/${esc(p.cover.replace(/^\.\//, ""))}" alt="" loading="lazy" decoding="async" />
						</a>`
				: "";
			return `					<article class="post${p.draft ? " is-draft" : ""}">
						${cover}
						<div class="post-body">
							<div class="post-meta">${esc(metaLine(p))}</div>
							<h2><a href="${href}">${esc(p.title)}</a></h2>
							<p>${esc(p.description)}</p>
							${tagList(p)}
							<a class="post-more" href="${href}">Read<span class="post-more-arrow">→</span></a>
						</div>
					</article>`;
		})
		.join("\n");

	return shell({
		title: "Epiq — blog",
		description:
			"Writing from the Epiq project: developer experience, event sourcing, Git internals, and building a terminal-native issue tracker.",
		canonical: `${BASE_URL}/blog.html`,
		image: `${BASE_URL}/og.jpeg`,
		depth: 0,
		body: `		<main id="top">
			<header class="docs-head wrap">
				<div class="kicker">Blog</div>
				<h1>Epiq lore.</h1>
				<p class="lead">An author's sketches.</p>
			</header>

			<div class="wrap rel-wrap">
				<div class="post-list">
${cards}
				</div>
			</div>
		</main>`,
	});
}

function renderPost(post, older, newer) {
	const article = md.render(post.body, {
		heading: 2,
		levels: true,
		images: true,
	});

	const cover = post.cover
		? `				<figure class="article-cover">
					<img src="${esc(post.cover)}" alt="${esc(post.coverAlt)}" />
				</figure>`
		: "";

	const source = post.devto
		? `					<p class="article-source">
						Originally published on
						<a class="inline-link" href="${esc(post.devto)}" rel="noopener">dev.to</a>.
					</p>`
		: "";

	const nav = [
		newer
			? `<a class="article-nav-link" href="./${esc(newer.slug)}.html"><span>← Newer</span><span class="article-nav-title">${esc(newer.title)}</span></a>`
			: "<span></span>",
		older
			? `<a class="article-nav-link is-next" href="./${esc(older.slug)}.html"><span>Older →</span><span class="article-nav-title">${esc(older.title)}</span></a>`
			: "<span></span>",
	].join("\n						");

	const jsonLd = {
		"@context": "https://schema.org",
		"@type": "BlogPosting",
		headline: post.title,
		description: post.description,
		datePublished: post.date,
		author: { "@type": "Person", name: AUTHOR },
		url: `${BASE_URL}/blog/${post.slug}.html`,
	};

	return shell({
		title: `${post.title} — Epiq`,
		description: post.description,
		canonical: `${BASE_URL}/blog/${post.slug}.html`,
		image: post.cover
			? `${BASE_URL}/blog/${post.cover.replace(/^\.\//, "")}`
			: `${BASE_URL}/og.jpeg`,
		depth: 1,
		head: `		<meta property="article:published_time" content="${esc(post.date)}" />
${post.draft ? '\t\t<meta name="robots" content="noindex" />\n' : ""}		<script type="application/ld+json">
${JSON.stringify(jsonLd, null, 2)}
		</script>`,
		body: `		<main id="top">
			<article class="article wrap">
				<header class="article-head">
					<a class="article-back" href="../blog.html">← Blog</a>
					<h1>${esc(post.title)}</h1>
					<div class="article-meta">${esc(metaLine(post))}</div>
					${tagList(post)}
				</header>

${cover}

				<div class="prose">
					${article}
				</div>

				<footer class="article-foot">
${source}
					<div class="article-nav">
						${nav}
					</div>
				</footer>
			</article>
		</main>`,
	});
}

/* ---------- the build ---------- */

function copyImages() {
	if (!existsSync(IMAGES_DIR)) return 0;
	const dest = join(OUT_DIR, "images");
	mkdirSync(dest, { recursive: true });
	let n = 0;
	for (const f of readdirSync(IMAGES_DIR)) {
		if (!IMAGE_EXTS.includes(extname(f).toLowerCase())) continue;
		copyFileSync(join(IMAGES_DIR, f), join(dest, f));
		n++;
	}
	return n;
}

function build({ quiet = false } = {}) {
	// README.md and anything prefixed with "_" are notes, not posts.
	const files = readdirSync(POSTS_DIR).filter(
		(f) => f.endsWith(".md") && f !== "README.md" && !f.startsWith("_")
	);
	const all = files.map(parsePost);

	const seen = new Map();
	for (const p of all) {
		if (seen.has(p.slug)) {
			throw new Error(`two posts share the slug "${p.slug}": ${seen.get(p.slug)} and ${p.slug}.md`);
		}
		seen.set(p.slug, `${p.slug}.md`);
	}

	// Drafts build so they can be previewed, but stay off the index.
	const posts = all.sort((a, b) => b.date.localeCompare(a.date));
	const published = posts.filter((p) => !p.draft);

	// docs/blog is generated wholesale, so stale pages never linger.
	rmSync(OUT_DIR, { recursive: true, force: true });
	mkdirSync(OUT_DIR, { recursive: true });

	writeFileSync(join(DOCS, "blog.html"), renderIndex(published));
	published.forEach((post, i) => {
		// published[] is newest-first, so the next entry is the older one.
		writeFileSync(
			join(OUT_DIR, `${post.slug}.html`),
			renderPost(post, published[i + 1], published[i - 1])
		);
	});
	for (const post of posts.filter((p) => p.draft)) {
		writeFileSync(join(OUT_DIR, `${post.slug}.html`), renderPost(post));
	}

	const images = copyImages();

	if (!quiet) {
		const drafts = posts.length - published.length;
		console.log(
			`built ${published.length} post${published.length === 1 ? "" : "s"}` +
				(drafts ? ` (+${drafts} draft)` : "") +
				` + index, ${images} image${images === 1 ? "" : "s"}`
		);
		for (const p of posts) {
			console.log(`  ${p.date}  blog/${p.slug}.html${p.draft ? "  [draft]" : ""}`);
		}
	}
	return posts;
}

/* ---------- scaffolding ---------- */

function scaffold(title) {
	const slug = slugify(title);
	if (!slug) throw new Error("give the post a title: --new \"My Title\"");
	const file = join(POSTS_DIR, `${slug}.md`);
	if (existsSync(file)) throw new Error(`${slug}.md already exists`);

	const today = new Date().toISOString().slice(0, 10);
	mkdirSync(POSTS_DIR, { recursive: true });
	writeFileSync(
		file,
		`---
title: ${title}
date: ${today}
tags:
draft: true
---

Write here. The first paragraph becomes the post's description unless you set
one in the frontmatter.

## A heading

Plain markdown: **bold**, _italic_, \`code\`, [links](https://example.com),
lists, tables, quotes and fenced code blocks all render in the site's style.

To add a picture, drop it in content/posts/images/ and reference it as
\`./images/name.webp\` — an image on its own line becomes a captioned figure.
Naming one \`${slug}.webp\` makes it this post's cover automatically.

See content/posts/README.md for the full list of frontmatter fields.
`
	);
	console.log(`created content/posts/${slug}.md`);
	console.log(`  preview:  npm run blog:serve`);
	console.log(`  publish:  remove "draft: true" from the frontmatter`);
}

/* ---------- watch + serve ---------- */

function rebuild() {
	try {
		build({ quiet: true });
		console.log(`[${new Date().toLocaleTimeString()}] rebuilt`);
	} catch (err) {
		console.error(`[${new Date().toLocaleTimeString()}] ${err.message}`);
	}
}

function startWatch() {
	let timer = null;
	const bump = () => {
		clearTimeout(timer);
		timer = setTimeout(rebuild, 80); // editors save in bursts
	};
	watch(POSTS_DIR, { recursive: true }, bump);
	watch(join(DOCS, "md.js"), bump);
	console.log("watching content/posts …");
}

const MIME = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json",
	".webp": "image/webp",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".mp4": "video/mp4",
};

function startServer(port) {
	createServer((req, res) => {
		const url = decodeURIComponent(req.url.split("?")[0]);
		let path = join(DOCS, url === "/" ? "blog.html" : url);
		if (existsSync(path) && statSync(path).isDirectory()) path = join(path, "index.html");
		if (!path.startsWith(DOCS) || !existsSync(path)) {
			res.writeHead(404, { "Content-Type": "text/plain" });
			return res.end("not found");
		}
		res.writeHead(200, {
			"Content-Type": MIME[extname(path).toLowerCase()] || "application/octet-stream",
			"Cache-Control": "no-store",
		});
		res.end(readFileSync(path));
	}).listen(port, () => {
		console.log(`preview:  http://localhost:${port}/blog.html`);
	});
}

/* ---------- entry ---------- */

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

try {
	const newAt = argv.indexOf("--new");
	if (newAt !== -1) {
		scaffold(argv.slice(newAt + 1).join(" ").trim());
	} else {
		build();
		if (has("--serve")) {
			const at = argv.indexOf("--port");
			startServer(at !== -1 ? Number(argv[at + 1]) : 8777);
			startWatch();
		} else if (has("--watch")) {
			startWatch();
		}
	}
} catch (err) {
	console.error(`\n  ${err.message}\n`);
	process.exit(1);
}
