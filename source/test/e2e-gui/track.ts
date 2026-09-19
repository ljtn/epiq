import {expect} from './fixtures.js';
import type {Locator, Page} from '@playwright/test';

/**
 * The chart with its window drawn.
 *
 * The board's name shows before the window has been fetched and paired, and
 * until then the axis is a single instant — a span of exactly 1, the floor
 * `buildAxis` gives an empty one. A press anywhere on such a track asks for
 * now, which the server checks out, parking the needle at the live end; a drag
 * across it picks a window of no width, which is no window at all. Either way
 * the gesture the test meant to make never happens, and what fails is some
 * assertion further down about what the gesture should have done.
 *
 * So every test that reaches for the track's geometry waits here first. It is
 * only ever a wait on a fetch that is already in flight — on an idle machine it
 * returns on the first poll — but it is the difference between a suite that
 * passes on a quiet laptop and one that passes under a full set of workers.
 */
export const trackWithWindow = async (page: Page): Promise<Locator> => {
	const track = page.getByTestId('scrubber-track');

	await expect
		.poll(async () => Number(await track.getAttribute('data-axis-span')))
		.toBeGreaterThan(1);

	return track;
};
