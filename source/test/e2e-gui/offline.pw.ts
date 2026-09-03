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

	// A drop it can recover from on its own. The retries are refused for as
	// long as the assertions take, because "reconnecting" is otherwise a state
	// the client leaves as fast as it can: the first attempt is scheduled half
	// a second after the cut and succeeds at once, which is not a window a poll
	// can be relied on to land in. Refusing holds it still instead.
	refuse = true;
	cut!();
	await expect(page.getByTestId('reconnecting')).toBeVisible();
	// Still retrying on its own: the button is what appears once they run out.
	await expect(page.getByTestId('connection-lost')).toHaveCount(0);

	// Allowed again, it comes back by itself — no button, no reload. Waiting
	// longer than the default here because recovery lands on the next attempt
	// in the schedule, and by this point that gap is up to eight seconds.
	refuse = false;
	await expect(page.getByTestId('reconnecting')).toHaveCount(0, {
		timeout: 20_000,
	});
	await expect(page.getByTestId('swimlane-menu').first()).toBeVisible();

	// Now one it cannot: every retry is refused. The schedule runs at a fifth
	// of its length from here, so the button arrives without sitting through
	// fifteen seconds of it.
	await page.evaluate('window.__epiqReconnectScale = 0.2');
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
	await expect(page.getByRole('button', {name: 'Board events'})).toBeDisabled();
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
