import {expect, test} from './fixtures.js';

const pick = (title: string) => `
(() => {
	const card = [...document.querySelectorAll('div[draggable="true"]')]
		.find(c => c.textContent.includes(${JSON.stringify(title)}));
	card.dispatchEvent(new MouseEvent('click', {bubbles: true, metaKey: true}));
	return true;
})()
`;

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

	for (const title of ['Bulk one', 'Bulk two']) {
		await page.getByRole('button', {name: '+', exact: true}).first().click();
		await page.getByPlaceholder('issue name').fill(title);
		await page.getByRole('button', {name: 'create', exact: true}).click();
		await page.goto(boardUrl);
		await expect(page.getByText(title, {exact: true}).first()).toBeVisible();
	}

	await page.evaluate(pick('Bulk one'));
	await page.evaluate(pick('Bulk two'));
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
			.filter(c => /Bulk (one|two)/.test(c.textContent) && c.textContent.includes('bulky'))
			.length
	`);
	console.log('[tagged]', tagged);

	expect(tagged, 'both tickets should carry the tag').toBe(2);
	expect(pageErrors).toEqual([]);
});
