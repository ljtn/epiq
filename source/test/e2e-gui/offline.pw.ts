import {expect, test} from './fixtures.js';

test.setTimeout(120_000);

test('the board stands down while the socket is gone, and comes back', async ({
	page,
	appUrl,
}) => {
	// Proxied so the socket can be cut and retries refused; `setOffline` leaves an open websocket up.
	let refuse = false;
	let cut: (() => void) | null = null;

	await page.routeWebSocket(/\/ws/, ws => {
		if (refuse) {
			ws.close();
			return;
		}

		const server = ws.connectToServer();
		ws.onMessage(message => server.send(message));
		server.onMessage(message => ws.send(message));
		cut = () => ws.close();
	});

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');
	await expect(page.getByTestId('add-issue').first()).toBeEnabled();

	// Retries refused to hold "reconnecting" still: the first retry would succeed at once.
	refuse = true;
	cut!();
	await expect(page.getByTestId('reconnecting')).toBeVisible();
	// Still retrying on its own: the button is what appears once they run out.
	await expect(page.getByTestId('connection-lost')).toHaveCount(0);

	// Recovers on its own; the next retry may be eight seconds off.
	refuse = false;
	await expect(page.getByTestId('reconnecting')).toHaveCount(0, {
		timeout: 20_000,
	});
	await expect(page.getByTestId('add-issue').first()).toBeEnabled();

	// Every retry refused, with the schedule sped up fivefold.
	await page.evaluate('window.__epiqReconnectScale = 0.2');
	refuse = true;
	cut!();

	// Readonly the way a scrub is readonly, so every existing guard stands down
	// together rather than each control growing its own offline case.
	await expect(page.getByTestId('add-issue').first()).toBeDisabled();
	await expect(page.getByTestId('add-swimlane')).toHaveCount(0);
	await expect(
		page.getByRole('button', {name: 'Week', exact: true}),
	).toBeDisabled();
	await expect(
		page.getByRole('button', {name: 'Events', exact: true}),
	).toBeDisabled();
	await expect(
		page.getByRole('button', {name: 'Volume', exact: true}),
	).toBeDisabled();
	await expect(page.getByTestId('series-select')).toBeDisabled();
	// Into the box itself: the name is on the label around it, and a label is
	// never the thing that is disabled.
	await expect(
		page.getByTestId('show-board-events').getByRole('checkbox'),
	).toBeDisabled();

	// Once the automatic attempts are spent the button takes over.
	await expect(page.getByTestId('connection-lost')).toBeVisible({
		timeout: 40_000,
	});

	refuse = false;
	await page.getByTestId('connection-lost').click();

	await expect(page.getByTestId('add-issue').first()).toBeEnabled();
	await expect(page.getByTestId('connection-lost')).toHaveCount(0);
	await expect(
		page.getByRole('button', {name: 'Week', exact: true}),
	).toBeEnabled();
});
