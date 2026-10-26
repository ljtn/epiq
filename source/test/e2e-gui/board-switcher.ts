import {expect} from './fixtures.js';
import type {Page} from '@playwright/test';

/** Switches the board on screen and waits for it; by test id, as the label changes. */
export const switchToBoard = async (page: Page, name: string) => {
	await page.getByTestId('board-switcher').click();
	await page
		.getByTestId('board-switcher-option')
		.filter({hasText: name})
		.click();
	await expect(page.getByTestId('board-switcher')).toContainText(name);
};
