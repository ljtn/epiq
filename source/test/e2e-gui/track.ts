import {expect} from './fixtures.js';
import type {Locator, Page} from '@playwright/test';

/**
 * The chart once its window is fetched; before that the axis is one instant,
 * and any press or drag on it does nothing meant.
 */
export const trackWithWindow = async (page: Page): Promise<Locator> => {
	const track = page.getByTestId('scrubber-track');

	await expect
		.poll(async () => Number(await track.getAttribute('data-axis-span')))
		.toBeGreaterThan(1);

	return track;
};
