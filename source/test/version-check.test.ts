import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
	clearUpdateCache,
	compareVersions,
	getUpdateInfo,
	parseReleaseNotes,
	releasesBetween,
	type Release,
} from '../lib/version/version-check.js';
import {pendingUpdate} from '../gui/client/lib/update-info.js';

const release = (version: string): Release => ({
	version,
	url: `https://example.test/v${version}`,
	publishedAt: null,
	sections: [],
});

describe('parseReleaseNotes', () => {
	it('reads titled sections of bullets, joining continued lines and dropping the version line', () => {
		const body =
			'v1.15.2\n\nTime travel\n- Cards show code at the needle\n- The needle is kept in the URL, so reloads\n  return to the same moment\n\nGUI\n- A bundled Inter typeface\n';

		expect(parseReleaseNotes(body)).toEqual([
			{
				title: 'Time travel',
				items: [
					'Cards show code at the needle',
					'The needle is kept in the URL, so reloads return to the same moment',
				],
			},
			{title: 'GUI', items: ['A bundled Inter typeface']},
		]);
	});

	it('keeps bullets with no title, takes markdown headings, and drops empty sections', () => {
		expect(
			parseReleaseNotes('- loose\n\n## Fixes\n* one\r\n\nNothing here\n'),
		).toEqual([
			{title: null, items: ['loose']},
			{title: 'Fixes', items: ['one']},
		]);
	});
});

describe('releasesBetween', () => {
	it('keeps the releases after current up to latest, newest first', () => {
		const all = ['1.14.0', '1.16.0', '1.15.2', '1.15.10', '1.17.0'].map(
			release,
		);

		expect(
			releasesBetween(all, '1.15.2', '1.16.0').map(r => r.version),
		).toEqual(['1.16.0', '1.15.10']);
	});
});

describe('compareVersions', () => {
	it('compares numerically, not as text', () => {
		expect(compareVersions('1.15.10', '1.15.9')).toBe(1);
		expect(compareVersions('v1.2.0', '1.2.0')).toBe(0);
	});
});

describe('pendingUpdate', () => {
	it('is null unless a newer version is named', () => {
		expect(pendingUpdate(null)).toBeNull();
		expect(
			pendingUpdate({
				current: '1.0.0',
				latest: null,
				updateAvailable: true,
				releases: [],
				currentPublishedAt: null,
				commands: {script: '', npm: ''},
			}),
		).toBeNull();
	});
});

describe('getUpdateInfo over the network', () => {
	const savedCi = process.env['IS_CI'];

	beforeEach(() => {
		delete process.env['IS_CI'];
		delete process.env['EPIQ_NO_UPDATE_CHECK'];
		clearUpdateCache();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
		if (savedCi !== undefined) process.env['IS_CI'] = savedCi;
	});

	it('answers "nothing newer" when the network fails, and does not ask again for an hour', async () => {
		vi.useFakeTimers({toFake: ['Date']});
		const fetch = vi.fn(async () => {
			throw new Error('offline');
		});
		vi.stubGlobal('fetch', fetch);

		const info = await getUpdateInfo('1.0.0');
		expect(info).toMatchObject({latest: null, updateAvailable: false});
		expect(info.releases).toEqual([]);

		await getUpdateInfo('1.0.0');
		expect(fetch).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(61 * 60 * 1000);
		await getUpdateInfo('1.0.0');
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('shares one request between callers and keeps an answer for a day', async () => {
		vi.useFakeTimers({toFake: ['Date']});
		const fetch = vi.fn(async (url: string) =>
			Response.json(
				url.includes('npmjs')
					? {version: '1.1.0'}
					: [
							{tag_name: 'v1.1.0', body: 'GUI\n- New', html_url: ''},
							{tag_name: 'v1.0.0', published_at: '2026-01-02T00:00:00Z'},
					  ],
			),
		);
		vi.stubGlobal('fetch', fetch);

		const [a, b] = await Promise.all([
			getUpdateInfo('1.0.0'),
			getUpdateInfo('1.0.0'),
		]);
		expect(a.latest).toBe('1.1.0');
		expect(b.releases.map(r => r.version)).toEqual(['1.1.0']);
		expect(b.currentPublishedAt).toBe('2026-01-02T00:00:00Z');
		expect(fetch).toHaveBeenCalledTimes(2);

		vi.advanceTimersByTime(23 * 60 * 60 * 1000);
		await getUpdateInfo('1.0.0');
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it('asks GitHub again within the hour while npm is ahead of its release', async () => {
		vi.useFakeTimers({toFake: ['Date']});
		let published = false;
		const fetch = vi.fn(async (url: string) =>
			Response.json(
				url.includes('npmjs')
					? {version: '1.1.0'}
					: [
							{tag_name: 'v1.1.0', prerelease: !published, body: '- New'},
							{tag_name: 'v1.0.0', published_at: 'not a date'},
					  ],
			),
		);
		vi.stubGlobal('fetch', fetch);

		const early = await getUpdateInfo('1.0.0');
		expect(early).toMatchObject({latest: '1.1.0', releases: []});
		expect(early.currentPublishedAt).toBeNull();

		published = true;
		vi.advanceTimersByTime(30 * 60 * 1000);
		await getUpdateInfo('1.0.0');
		expect(fetch).toHaveBeenCalledTimes(2);

		vi.advanceTimersByTime(31 * 60 * 1000);
		const late = await getUpdateInfo('1.0.0');
		expect(late.releases.map(r => r.version)).toEqual(['1.1.0']);
		expect(fetch).toHaveBeenCalledTimes(3);

		vi.advanceTimersByTime(2 * 60 * 60 * 1000);
		await getUpdateInfo('1.0.0');
		expect(fetch).toHaveBeenCalledTimes(3);
	});

	it('takes a malformed answer as no update', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({version: 'v.1.3.2'})),
		);

		expect(await getUpdateInfo('1.0.0')).toMatchObject({
			latest: null,
			updateAvailable: false,
		});
	});
});
