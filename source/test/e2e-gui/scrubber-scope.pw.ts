import {expect, test} from './fixtures.js';

// The hour axis is under a day, so it draws no hour labels; every wider scope
// does. That difference is what tells the two windows apart on screen.
const HOUR_LABELS =
	"[...document.querySelectorAll('span')].filter(e => e.textContent === '12:00').length";

// Held back so the reply for the scope being left is still in flight when the
// next one is picked. This does not reproduce the reported mismatch — nothing
// here has yet — it pins the invariant the report is about: whatever the scope
// buttons say, the axis has to be that scope's.
const COMMITS_REPLY_DELAY_MS = 900;

test('the chart follows the scope that is selected', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.routeWebSocket(/\/ws/, ws => {
		const server = ws.connectToServer();

		ws.onMessage(message => server.send(message));
		server.onMessage(async message => {
			if (
				typeof message === 'string' &&
				message.startsWith('{"type":"commits"')
			) {
				await new Promise(resolve =>
					setTimeout(resolve, COMMITS_REPLY_DELAY_MS),
				);
			}

			ws.send(message);
		});
	});

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await page.getByRole('button', {name: 'Events', exact: true}).click();

	for (const gap of [0, 120, 400, 800]) {
		await page.getByRole('button', {name: 'Hour', exact: true}).click();
		await page.waitForTimeout(gap);
		await page.getByRole('button', {name: 'Day', exact: true}).click();

		await expect
			.poll(async () => page.evaluate<number>(HOUR_LABELS), {timeout: 15_000})
			.toBeGreaterThan(0);
	}

	expect(pageErrors).toEqual([]);
});
