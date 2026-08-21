import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// Same approach as drag.pw.ts: native drag cannot be driven by synthetic mouse
// input, so the events the browser would fire are dispatched directly over one
// shared DataTransfer.
const dragLane = (from: string, onto: string, side: 'left' | 'right') => `
new Promise(async resolve => {
	const wait = ms => new Promise(r => setTimeout(r, ms));
	const handleFor = name => [
		...document.querySelectorAll('[data-testid="swimlane-handle"]'),
	].find(h => h.textContent.includes(name));

	const src = handleFor(${JSON.stringify(from)});
	const targetColumn = handleFor(${JSON.stringify(onto)}).parentElement;

	const dt = new DataTransfer();
	const rect = targetColumn.getBoundingClientRect();
	// Which half the pointer is over is what decides the landing edge.
	const clientX = ${JSON.stringify(side)} === 'left'
		? rect.left + 10
		: rect.right - 10;

	const fire = (el, type, x) => el.dispatchEvent(new DragEvent(type, {
		bubbles: true, cancelable: true, composed: true, dataTransfer: dt,
		clientX: x ?? el.getBoundingClientRect().left + 20,
		clientY: el.getBoundingClientRect().top + 10,
	}));

	fire(src, 'dragstart');
	await wait(50);
	fire(targetColumn, 'dragenter', clientX);
	fire(targetColumn, 'dragover', clientX);
	await wait(50);
	const indicators = document.querySelectorAll(
		'[data-testid="swimlane-drop-indicator"]',
	).length;
	fire(targetColumn, 'drop', clientX);
	fire(src, 'dragend');

	await wait(2500);
	resolve({indicators});
});
`;

const ORDER = `[...document.querySelectorAll('[data-testid="swimlane-handle"]')]
	.map(h => h.textContent.trim().split('(')[0].trim())`;

// Only this test's own lanes. The suite shares one board and other files add
// columns to it, so asserting the whole row would depend on their run order.
const orderOf = async (page: Page, names: string[]) =>
	(await page.evaluate<string[]>(ORDER)).filter(name => names.includes(name));

const addLane = async (page: Page, name: string) => {
	await page.getByTestId('add-swimlane').click();
	await page.getByPlaceholder('swimlane name').fill(name);
	await page.getByPlaceholder('swimlane name').press('Enter');
	await expect(page.getByText(name)).toBeVisible();
};

const deleteLane = async (page: Page, name: string) => {
	await page
		.locator('section')
		.filter({hasText: name})
		.getByTestId('swimlane-menu')
		.click();
	await page.getByTestId('swimlane-menu-delete').click();
	await page
		.getByTestId('confirm-modal')
		.getByRole('button', {name: 'delete'})
		.click();
	await expect(page.getByText(name)).toHaveCount(0);
};

test.setTimeout(120_000);

test('dragging a swimlane header reorders the board', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const stamp = Date.now();
	const first = `Drag A ${stamp}`;
	const second = `Drag B ${stamp}`;

	// Both append, so they start adjacent and in this order.
	await addLane(page, first);
	await addLane(page, second);
	expect(await orderOf(page, [first, second])).toEqual([first, second]);

	const {indicators} = await page.evaluate<{indicators: number}>(
		dragLane(first, second, 'right'),
	);

	// Exactly one edge line, on the column being dropped against.
	expect(indicators).toBe(1);
	expect(await orderOf(page, [first, second])).toEqual([second, first]);

	// Survives the round-trip, rather than only living in the optimistic state.
	await page.reload();
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	expect(await orderOf(page, [first, second])).toEqual([second, first]);

	// And back the other way, so the reverse index is covered too.
	await page.evaluate(dragLane(first, second, 'left'));
	expect(await orderOf(page, [first, second])).toEqual([first, second]);

	await deleteLane(page, first);
	await deleteLane(page, second);

	expect(pageErrors).toEqual([]);
});

test('a swimlane header is not draggable on a readonly board', async ({
	page,
	appUrl,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page.getByTestId('swimlane-handle').first()).toHaveAttribute(
		'draggable',
		'true',
	);

	await page.getByTestId('board-switcher').click();
	await page
		.getByTestId('board-switcher-option')
		.filter({hasText: 'Closed'})
		.click();
	await expect(page.getByTestId('board-switcher')).toContainText('Closed');

	await expect(page.getByTestId('swimlane-handle').first()).toHaveAttribute(
		'draggable',
		'false',
	);
});
