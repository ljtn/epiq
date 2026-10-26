import {expect, readHandoff, test} from './fixtures.js';
import {serveDist} from './serve-dist.js';

// The one file that opens the shipped `dist/index.js` rather than running from
// source, to catch packaging regressions.
let dist: {url: string; kill: () => void};

// Booting the built bundle is slower than reaching an already-warm server.
test.describe.configure({timeout: 90_000});

// The empty pattern asks Playwright for no fixtures.
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

// The client is code-split, so each chunk must resolve, not just index.html.
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
