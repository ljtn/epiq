// Getting a board on screen, and putting it back where the next test expects
// to find it. Shared rather than copied: the worker's server is shared too, so
// a file that leaves the board in the past breaks the one that runs after it.

import type {Page} from '@playwright/test';
import {expect} from './fixtures.js';

// The suite shares one server, and a board left parked in the past never
// finishes loading for the next test.
export const returnToLive = async (page: Page) => {
	const exit = page.getByTestId('theatre-exit');
	// The button carries the word "Resume" only while the board is in the past,
	// so its absence is what live looks like.
	const resume = page.getByRole('button', {name: 'Resume', exact: true});

	if ((await exit.count()) > 0) await exit.click();

	// Pressed until it takes, rather than asked once: a request for live is a
	// message like any other and a socket replaced under it drops it silently,
	// which would leave the board parked in the past for the rest of the file.
	await expect(async () => {
		if ((await resume.count()) === 0) return;
		// Bounded: the word goes the moment live lands, and an unbounded click on
		// a button that has already lost its name would sit out the whole retry
		// budget.
		await resume.click({timeout: 1_000});

		await expect(resume).toHaveCount(0, {timeout: 2_000});
	}).toPass({timeout: 20_000});
};

export const openBoard = async (page: Page, appUrl: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
};
