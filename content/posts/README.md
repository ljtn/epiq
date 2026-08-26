# Writing a post

Posts are plain markdown in this folder. One file per post, named after its
URL: `vision-drift.md` becomes `/blog/vision-drift.html`.

Everything under `docs/blog/` is generated. Never edit it by hand.

## The loop

```sh
npm run blog:new -- "My New Post"   # scaffold
npm run blog:serve                  # preview on :8777, rebuilds on save
```

Leave `blog:serve` running while you write. Save the file, refresh the browser.
Prefer opening the files straight off disk? `npm run blog:watch` rebuilds on
save without starting a server.
When you're happy, delete `draft: true` and build once more:

```sh
npm run build:blog
```

Then commit the markdown **and** the generated `docs/` output — GitHub Pages
serves the committed HTML, there is no build step on their side.

## Frontmatter

Only `title` and `date` are required:

```yaml
---
title: My New Post
date: 2026-08-26
---
```

Everything else is optional and derived when you leave it out:

| Field | If you omit it |
| --- | --- |
| `slug` | taken from the filename |
| `description` | the first paragraph, trimmed to ~158 characters |
| `reading_time` | word count at 275 wpm |
| `cover` | `images/<slug>.<ext>` if that file exists |
| `cover_alt` | empty — set it when the cover carries meaning |
| `tags` | none; write them comma-separated: `tags: git, tui` |
| `draft` | published; `draft: true` keeps it off the index |
| `devto` | no "originally published" line |

## Styling

There is none to do. Write markdown and it comes out in the site's style:
headings, **bold**, _italic_, `code`, links, nested lists, numbered lists,
tables, blockquotes, fenced code blocks, horizontal rules and images.

Two line-ending spaces make a hard line break. A heading's depth is preserved,
so `##` and `###` nest as you'd expect — start at `##`, since the post title is
already the page's `<h1>`.

Not supported: setext headings (`===` underlines), reference-style links
(`[x][1]`), and inline HTML — all of which are escaped rather than rendered.

## Pictures

Drop the file in `content/posts/images/` and reference it relative to that:

```markdown
![A short description of the picture](./images/my-picture.webp)
```

The same path works in your editor's markdown preview and in the built page.
An image on its own line becomes a figure, and its alt text becomes the
caption — so write alt text worth reading.

Name an image after the post (`my-new-post.webp`) and it becomes the cover
automatically, used on the index card and as the social preview.

Covers get displayed about 1440px wide. Large PNGs are worth converting first:

```sh
magick big.png -resize 1440x -strip out.png && cwebp -q 84 out.png -o final.webp
```
