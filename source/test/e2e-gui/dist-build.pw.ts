import {expect, readHandoff, test} from './fixtures.js';
import {serveDist} from './serve-dist.js';

// Everything else in this suite runs the server from source under `IS_LOCAL`.
// This file is the one that opens the shipped artefact: `dist/index.js`, the
// minified bundle, resolving the client from `dist/gui` beside itself. A
// bundling or path regression that only shows up once packaged has no other
// test to fail.
let dist: {url: string; kill: () => void};

// Booting the built bundle is slower than reaching an already-warm server.
test.describe.configure({timeout: 90_000});

// Playwright reads the requested fixtures off the destructuring pattern, so
// the empty one is how a hook asks for none and still receives the worker.
// eslint-disable-next-line no-empty-pattern
test.beforeAll(async ({}, workerInfo) => {
	const handoff = readHandoff(workerInfo.parallelIndex);
	dist = await serveDist(handoff.repoRoot, handoff.globalDir);
});

test.afterAll(() => dist?.kill());

test('serves the client from the built bundle', async ({page, pageErrors}) => {
	await page.goto(dist.url);

	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page.getByText('Todo')).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// The client is code-split, so index.html loading proves nothing about the
// chunks a route pulls in later; each is resolved through the same static
// handler, and a packaging change can drop them individually.
test('serves every asset the built client asks for', async ({
	page,
	pageErrors,
}) => {
	const notFound: string[] = [];

	page.on('response', response => {
		if (response.status() === 404) notFound.push(response.url());
	});

	await page.goto(dist.url);
	await expect(page.getByText('Todo')).toBeVisible();

	expect(notFound).toEqual([]);
	expect(pageErrors).toEqual([]);
});
