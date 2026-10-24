import {expect, test} from './fixtures.js';
import {EPIQ_VERSION} from '../../version.js';

const LATEST = '99.0.0';

// The server never asks npm in the suite; this stands in for its answer.
const fakeUpdate = {
	current: EPIQ_VERSION,
	latest: LATEST,
	updateAvailable: true,
	currentPublishedAt: '2026-10-01T10:00:00Z',
	commands: {
		script: 'curl -fsSL https://example.test/install.sh | sh',
		npm: 'npm install --global epiq@latest',
	},
	releases: [
		{
			version: LATEST,
			url: 'https://example.test/v99.0.0',
			publishedAt: '2026-10-20T10:00:00Z',
			sections: [{title: 'GUI', items: ['A shiny new thing']}],
		},
	],
};

test('a newer epiq shows in the header and opens what changed', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.routeWebSocket(/\/ws/, ws => {
		const server = ws.connectToServer();
		ws.onMessage(message => server.send(message));
		server.onMessage(message => {
			ws.send(
				typeof message === 'string' && message.startsWith('{"type":"version"')
					? JSON.stringify({type: 'version', payload: fakeUpdate})
					: message,
			);
		});
	});

	await page.goto(appUrl);

	const badge = page.getByTestId('version-update');
	await expect(badge).toHaveText(`v${EPIQ_VERSION}`);

	await badge.click();
	const popover = page.getByTestId('version-popover');
	await expect(popover).toContainText(`Epiq ${LATEST} is available`);
	await expect(popover).toContainText('A shiny new thing');
	await expect(page.getByTestId('version-current-age')).toContainText(
		'Released',
	);
	await expect(page.getByTestId('version-releases')).toHaveCSS(
		'overflow-y',
		'auto',
	);
	const command = page.getByTestId('version-command');
	await expect(command).toHaveText(fakeUpdate.commands.script);
	await page.getByTestId('version-tab-npm').click();
	await expect(command).toHaveText(fakeUpdate.commands.npm);
	await page.getByTestId('version-tab-curl').click();
	await expect(command).toHaveText(fakeUpdate.commands.script);
	await page.keyboard.press('Escape');
	await expect(popover).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test('with nothing newer, the header shows the plain version', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await page.goto(appUrl);

	await expect(page.getByTestId('version')).toHaveText(`v${EPIQ_VERSION}`);
	await expect(page.getByTestId('version-update')).toHaveCount(0);
	expect(pageErrors).toEqual([]);
});
