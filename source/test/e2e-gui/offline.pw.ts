import {expect, test} from './fixtures.js';

test.setTimeout(120_000);

test('the board stands down while the socket is gone, and comes back', async ({
	page,
	appUrl,
}) => {
	// Proxied so the socket can be cut mid-session, and so the retries can be
	// refused. `setOffline` blocks new requests but leaves an already-open
	// websocket up, so the client never learns it is gone.
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
	await expect(page.getByTestId('swimlane-menu').first()).toBeVisible();

	// A drop it can recover from on its own.
	cut!();
	await expect(page.getByTestId('reconnecting')).toBeVisible();
	await expect(page.getByTestId('swimlane-menu').first()).toBeVisible();

	// Now one it cannot: every retry is refused.
	refuse = true;
	cut!();

	// Readonly the way a scrub is readonly, so every existing guard stands down
	// together rather than each control growing its own offline case.
	await expect(page.getByTestId('swimlane-menu')).toHaveCount(0);
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
	await expect(
		page.getByRole('button', {name: 'All board events'}),
	).toBeDisabled();
	await expect(page.getByTitle('Show board events')).toBeDisabled();

	// Once the automatic attempts are spent the button takes over.
	await expect(page.getByTestId('connection-lost')).toBeVisible({
		timeout: 40_000,
	});

	refuse = false;
	await page.getByTestId('connection-lost').click();

	await expect(page.getByTestId('swimlane-menu').first()).toBeVisible();
	await expect(page.getByTestId('connection-lost')).toHaveCount(0);
	await expect(
		page.getByRole('button', {name: 'Week', exact: true}),
	).toBeEnabled();
});
