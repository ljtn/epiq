import {expect, test} from './fixtures.js';

// Native drag cannot be driven by synthetic mouse input, so the events the
// browser would fire are dispatched directly. One DataTransfer is shared, as a
// real drag does, so the id set on dragstart survives to the drop.
const DRAG = `
new Promise(async resolve => {
	const wait = ms => new Promise(r => setTimeout(r, ms));
	const cards = [...document.querySelectorAll('div[draggable="true"]')];
	const src = cards.find(c => c.textContent.includes('Alpha'));

	const target = [...document.querySelectorAll('header')]
		.find(h => /In progress/.test(h.textContent)).parentElement;

	const dt = new DataTransfer();
	const fire = (el, type) => el.dispatchEvent(new DragEvent(type, {
		bubbles: true, cancelable: true, composed: true, dataTransfer: dt,
		clientX: el.getBoundingClientRect().left + 20,
		clientY: el.getBoundingClientRect().top + 10,
	}));

	const before = location.pathname;

	fire(src, 'dragstart');
	await wait(50);
	// A navigation here remounts the board and the drop lands on nothing.
	const pathAfterDragStart = location.pathname;

	fire(target, 'dragenter');
	fire(target, 'dragover');
	await wait(50);
	fire(target, 'drop');
	fire(src, 'dragend');

	await wait(2500);

	const dump = [...document.querySelectorAll('header')].map(h => ({
		head: h.textContent.trim().slice(0, 30),
		cards: [...h.parentElement.querySelectorAll('div[draggable="true"]')]
			.map(c => c.textContent.trim().slice(0, 20)),
	}));

	resolve({
		navigatedOnDragStart: pathAfterDragStart !== before,
		dump,
	});
})
`;

test.setTimeout(120_000);

test('dragging a ticket to another swimlane moves it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	await page.getByRole('button', {name: '+', exact: true}).first().click();
	await page.getByPlaceholder('issue name').fill('Alpha');
	await page.getByRole('button', {name: 'create', exact: true}).click();
	await page.goto(boardUrl);
	await expect(page.getByText('Alpha', {exact: true}).first()).toBeVisible();

	const {navigatedOnDragStart, dump} = await page.evaluate<{
		navigatedOnDragStart: boolean;
		dump: {head: string; cards: string[]}[];
	}>(DRAG);

	const lane = (name: string) =>
		dump.find(entry => entry.head.startsWith(name));

	expect(navigatedOnDragStart, 'picking a card up must not navigate').toBe(
		false,
	);
	expect(
		lane('In progress')?.cards.join(),
		'Alpha should have landed',
	).toContain('Alpha');
	expect(lane('Todo')?.cards.join()).not.toContain('Alpha');
	expect(pageErrors).toEqual([]);
});
