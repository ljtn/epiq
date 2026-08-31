import type {Page} from '@playwright/test';
import {expect, test} from './fixtures.js';

// A real 64x64 PNG. The store sniffs magic bytes rather than trusting the
// name, so this has to be a genuine one — and it has to have real dimensions,
// or the rendered <img> is a pixel wide and proves nothing.
const PNG_BASE64 =
	'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABMElEQVR4nNXCsSoGAABG0W8wGAwGg8FgMBgMBoPBYDBIkiTpJkmSJEmSJEmSJEmSJEl/kiRJkiRJMhgMBoPBYDAYDAaDwXPc00l4dC/iQT3F3KunhDv1lHKrnjJu1FPOtXoquFJPJZfqqeJCPdWcq6eGM/XUcqqeOk7UU8+xeho4Uk8jh+pp4kA9zRTU08q+etrZU08nu+rpZkc9PWyrp48t9QywqZ4hNtQzwrp6xlhTzwSr6pliRT0zLKtnjiX1LLConiUW1LPCvHrWmFPPBrPq2WJGPTtMq2ePKfUUmFTPIRPqOWZcPaeMqeecUfVcMqKea4bVc8uQeu4ZVM8jA+p5ol89z/Sp54Ve9bzSo543UM873er5oEs9n3Sq54sO9XzTrp4f2tTzS6t6/mhR/wcnahFL3vsGUgAAAABJRU5ErkJggg==';

const pngFile = {
	name: 'shot.png',
	mimeType: 'image/png',
	buffer: Buffer.from(PNG_BASE64, 'base64'),
};

const openTicket = async (page: Page, appUrl: string, label: string) => {
	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	await page.getByTitle('Add issue').first().click();
	await page.getByPlaceholder('issue name').fill(`${label} ${Date.now()}`);
	await page.getByPlaceholder('issue name').press('Enter');
	await expect(page).toHaveURL(/\/issue\//);
};

// The reference the server hands back, which is what has to reach the body.
const MEDIA_REF = /!\[[^\]]*\]\(\/media\/[a-f0-9]{64}\.(png|jpg|gif|webp)\)/;

test('the description editor takes an image and leaves the reference at the cursor', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicket(page, appUrl, 'Desc image');

	await page.getByRole('button', {name: 'edit'}).first().click();
	const box = page.getByRole('textbox').last();
	await box.fill('before');

	// The picker is hidden, so the file goes to the input the button clicks —
	// by testid, since the Attachments section has one of its own on this tab.
	await page.getByTestId('description-image-input').setInputFiles(pngFile);

	await expect(box).toHaveValue(MEDIA_REF, {timeout: 15_000});
	// Inserted after what was already typed, on a line of its own.
	expect((await box.inputValue()).startsWith('before\n![')).toBe(true);

	// And it survives the save, rendering as a real image.
	await page.getByRole('button', {name: 'save', exact: true}).click();
	const image = page.locator('aside a[href^="/media/"] img').first();
	await expect(image).toBeVisible();

	// Not a broken one, and not the attachments thumbnail either: the route
	// answers with the real 64x64 bitmap. Typed structurally rather than as an
	// HTMLImageElement, which this tsconfig has no DOM lib to supply.
	const naturalWidth = await image.evaluate(
		node => (node as unknown as {naturalWidth: number}).naturalWidth,
	);
	expect(naturalWidth).toBe(64);

	expect(pageErrors).toEqual([]);
});

test('the comment composer takes an image too', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicket(page, appUrl, 'Comment image');

	await page.getByRole('button', {name: /^Comments/}).click();
	const composer = page.getByPlaceholder('write a comment');
	await composer.fill('look at this');

	await page.getByTestId('comment-image-input').setInputFiles(pngFile);
	await expect(composer).toHaveValue(MEDIA_REF, {timeout: 15_000});

	await page.getByRole('button', {name: 'comment', exact: true}).click();

	const image = page.locator('aside a[href^="/media/"] img').first();
	await expect(image).toBeVisible();

	expect(pageErrors).toEqual([]);
});

// Dropping onto the composer, rather than onto the Attachments section that
// already accepted one.
test('dropping an image on the comment composer inserts it', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openTicket(page, appUrl, 'Drop image');

	await page.getByRole('button', {name: /^Comments/}).click();
	const composer = page.getByPlaceholder('write a comment');

	// A source string for the same reason: DataTransfer and File are DOM
	// values, which this tsconfig does not carry.
	const handle = await page.evaluateHandle(`(() => {
		const bytes = Uint8Array.from(atob('${PNG_BASE64}'), c => c.charCodeAt(0));
		const transfer = new DataTransfer();
		transfer.items.add(new File([bytes], 'dropped.png', {type: 'image/png'}));
		return transfer;
	})()`);

	await composer.dispatchEvent('dragover', {dataTransfer: handle});
	await composer.dispatchEvent('drop', {dataTransfer: handle});

	await expect(composer).toHaveValue(MEDIA_REF, {timeout: 15_000});

	expect(pageErrors).toEqual([]);
});
