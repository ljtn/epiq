import {expect, test} from './fixtures.js';

const click = (title: string, modifier: boolean) => `
(() => {
	const card = [...document.querySelectorAll('div[draggable="true"]')]
		.find(c => c.textContent.includes(${JSON.stringify(title)}));
	card.dispatchEvent(new MouseEvent('click', {
		bubbles: true,
		metaKey: ${String(modifier)},
	}));
	return true;
})()
`;

const pick = (title: string) => click(title, true);

const panel = `
(() => {
	const aside = document.querySelector('aside');
	return aside ? aside.innerText.replace(/\\s+/g, ' ').slice(0, 400) : null;
})()
`;

test.setTimeout(180_000);

test('picking several tickets opens a bulk overview', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const tag = `B${Math.floor(Math.random() * 1e6)}`;
	const titles = [`${tag}-one`, `${tag}-two`];

	for (const title of titles) {
		await page.getByRole('button', {name: '+', exact: true}).first().click();
		await page.getByPlaceholder('issue name').fill(title);
		await page.getByRole('button', {name: 'create', exact: true}).click();
		await page.waitForTimeout(1500);
		await page.goto(boardUrl);
		await page.waitForTimeout(500);
		await expect(page.getByText(title, {exact: true}).first()).toBeVisible();
	}

	await page.evaluate(pick(titles[0]!));
	await page.evaluate(pick(titles[1]!));
	await page.waitForTimeout(300);

	const text = await page.evaluate<string | null>(panel);
	console.log('[panel]', text);

	expect(text, 'bulk panel should be showing').toContain('2 tickets selected');
	const commentsTab = await page.evaluate<boolean>(`
		[...document.querySelectorAll('aside button')]
			.some(b => b.textContent.trim() === 'Comments')
	`);
	expect(commentsTab, 'no bulk commenting').toBe(false);

	// A bulk tag must reach both tickets.
	await page.evaluate(`
		(() => {
			const btn = [...document.querySelectorAll('aside button')]
				.find(b => b.textContent.trim() === 'add');
			const input = document.querySelector('aside input');
			const setter = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype, 'value').set;
			setter.call(input, 'bulky');
			input.dispatchEvent(new Event('input', {bubbles: true}));
			btn.click();
			return true;
		})()
	`);

	await page.waitForTimeout(2500);
	await page.goto(boardUrl);
	await page.waitForTimeout(1200);

	const tagged = await page.evaluate<number>(`
		[...document.querySelectorAll('div[draggable="true"]')]
			.filter(c => c.textContent.includes('${tag}-') && c.textContent.includes('bulky'))
			.length
	`);
	console.log('[tagged]', tagged);

	expect(tagged, 'both tickets should carry the tag').toBe(2);
	expect(pageErrors).toEqual([]);
});

test('a plain click then a shift-click selects both', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const tag = `F${Math.floor(Math.random() * 1e6)}`;
	const titles = [`${tag}-one`, `${tag}-two`];

	for (const title of titles) {
		await page.getByRole('button', {name: '+', exact: true}).first().click();
		await page.getByPlaceholder('issue name').fill(title);
		await page.getByRole('button', {name: 'create', exact: true}).click();
		await page.waitForTimeout(1500);
		await page.goto(boardUrl);
		await page.waitForTimeout(500);
		await expect(page.getByText(title, {exact: true}).first()).toBeVisible();
	}

	// Opens the ticket without picking it.
	await page.evaluate(click(titles[0]!, false));
	await page.waitForTimeout(400);

	// Extends from the open one rather than starting over.
	await page.evaluate(click(titles[1]!, true));
	await page.waitForTimeout(400);

	const text = await page.evaluate<string | null>(panel);
	console.log('[flow panel]', text);

	expect(text).toContain('2 tickets selected');
	expect(pageErrors).toEqual([]);
});

test('a click on the board clears the selection', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	const boardUrl = page.url();

	const tag = `C${Math.floor(Math.random() * 1e6)}`;
	const titles = [`${tag}-one`, `${tag}-two`];

	for (const title of titles) {
		await page.getByRole('button', {name: '+', exact: true}).first().click();
		await page.getByPlaceholder('issue name').fill(title);
		await page.getByRole('button', {name: 'create', exact: true}).click();
		await page.waitForTimeout(1500);
		await page.goto(boardUrl);
		await page.waitForTimeout(500);
	}

	await page.evaluate(click(titles[0]!, false));
	await page.evaluate(click(titles[1]!, true));
	await page.waitForTimeout(400);

	expect(await page.evaluate<string | null>(panel)).toContain(
		'2 tickets selected',
	);

	// Anywhere on the board that is not a card.
	await page.evaluate(`
		(() => {
			document.querySelector('main').dispatchEvent(
				new MouseEvent('click', {bubbles: true}),
			);
			return true;
		})()
	`);
	await page.waitForTimeout(400);

	const after = await page.evaluate<string | null>(panel);
	console.log('[after board click]', after);

	expect(after ?? '').not.toContain('tickets selected');
	expect(pageErrors).toEqual([]);
});
