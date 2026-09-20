import {expect} from './fixtures.js';
import type {Page} from '@playwright/test';

/**
 * Moves the board on screen, and waits for it to have moved.
 *
 * Addressed by test id, not by text: the trigger's label is the current board,
 * so a text selector cannot address it across the change it is driving.
 */
export const switchToBoard = async (page: Page, name: string) => {
	await page.getByTestId('board-switcher').click();
	await page
		.getByTestId('board-switcher-option')
		.filter({hasText: name})
		.click();
	await expect(page.getByTestId('board-switcher')).toContainText(name);
};
