import {expect, test} from './fixtures.js';
import {openBoard} from './live-board.js';

// Files a ticket in the first lane and moves it to the second over the socket,
// the way move.pw.ts does, and hands back the lanes it travelled between.
const SCRIPT = `
new Promise(async resolve => {
	const ws = new WebSocket('ws://' + window.location.host + '/ws');
	let latest = null;

	ws.addEventListener('message', event => {
		const msg = JSON.parse(event.data);
		if (msg.type === 'state') latest = msg.payload?.value ?? null;
	});

	const send = b => ws.send(JSON.stringify(b));
	const next = type => new Promise(r => {
		const handler = event => {
			if (JSON.parse(event.data).type !== type) return;
			ws.removeEventListener('message', handler);
			r();
		};
		ws.addEventListener('message', handler);
	});
	const refresh = async () => {
		const state = next('state');
		send({type: 'state:get'});
		await state;
	};

	await new Promise(r => ws.addEventListener('open', r));
	await refresh();

	const [from, to] = latest.boards[0].swimlanes;
	const title = 'F' + Math.floor(Math.random() * 1e6);

	const created = next('issues:create:result');
	send({type: 'issues:create', payload: {parentId: from.id, title}});
	await created;
	await refresh();

	const issue = latest.boards[0].swimlanes
		.flatMap(l => l.issues)
		.find(i => i.title === title);

	const moved = next('issues:move:result');
	send({
		type: 'issues:move',
		payload: {issueId: issue.id, parentId: to.id, position: {at: 'end'}},
	});
	await moved;

	ws.close();
	resolve({id: issue.id, ref: issue.ref, title, from: from.title, to: to.title});
});
`;

test('the flow layout draws a moved ticket on the lane it went to', async ({
	page,
	appUrl,
	pageErrors,
}) => {
	await openBoard(page, appUrl);

	const {id, ref, title, from, to} = await page.evaluate<{
		id: string;
		ref: string;
		title: string;
		from: string;
		to: string;
	}>(SCRIPT);

	// The chart is a picture of the window fetched on load, refetched live only
	// with the log open or the board narrowed to the window — so load again.
	await openBoard(page, appUrl);
	await page.getByRole('button', {name: 'Flow', exact: true}).click();
	await expect(page).toHaveURL(/layout=flow/);

	const canvas = page.getByTestId('flow-canvas');
	await expect(canvas).toHaveAttribute('data-entrance', 'done');
	await expect
		.poll(async () => Number(await canvas.getAttribute('data-paths')), {
			timeout: 20_000,
		})
		.toBeGreaterThan(0);

	// No commits in this layout, so the Code series is not on offer — but its
	// value is kept, for the log and for the other layouts.
	const codeSeries = page.getByTestId('show-commits').first();
	await expect(codeSeries).toBeVisible();
	// Found by name, but still checked for the idle wording — that is what says
	// the series is off the table in this layout rather than merely unticked.
	await expect(codeSeries).toHaveAttribute('title', 'Flow draws tickets only');
	await expect(page.getByTestId('commit-select')).toBeDisabled();
	await page.getByRole('button', {name: 'Events', exact: true}).click();
	await expect(page.getByTestId('commit-select')).toBeEnabled();
	await page.getByRole('button', {name: 'Flow', exact: true}).click();

	// A strand per lane, the closed one last.
	const track = page.getByTestId('scrubber-track');
	await expect(track.getByText(from, {exact: true})).toBeVisible();
	await expect(track.getByText(to, {exact: true})).toBeVisible();
	await expect(track.getByText('Closed', {exact: true})).toBeVisible();

	// Narrowed to the ticket, the window is its own life and the chart its one
	// line: born on the first lane, and on the second from the move onwards,
	// which is most of the width — the move came a breath after the creation,
	// and the window runs on to the fetch. Over the whole window that stretch
	// is a few pixels at the live end, under the needle's grip.
	await page.getByText(title, {exact: true}).first().click();
	const ticketOnly = page.getByTestId('ticket-only');
	await expect(ticketOnly).toBeEnabled();
	await ticketOnly.click();
	await expect(ticketOnly).toHaveAttribute('aria-pressed', 'true');
	await expect
		.poll(async () => Number(await canvas.getAttribute('data-paths')), {
			timeout: 20_000,
		})
		.toBe(1);
	await expect(canvas).toHaveAttribute('data-entrance', 'done');

	const label = await track.getByText(to, {exact: true}).boundingBox();
	const box = await canvas.boundingBox();
	if (!label || !box) throw new Error('flow chart not laid out');

	// Swept along the strand rather than placed: one move is one event, and a
	// busy machine has dropped it.
	const y = label.y + label.height / 2;
	await page.mouse.move(box.x + box.width * 0.9, y);
	await page.mouse.move(box.x + box.width * 0.6, y, {steps: 10});

	const hint = page.getByTestId('board-hint');
	await expect(hint).toContainText(ref);
	await expect(hint).toContainText(`In ${to}`);

	// The hovered line is the one singled out — and with the pointer gone, the
	// open ticket's is, so the others stay muted around it.
	await expect(canvas).toHaveAttribute('data-focus', id);

	await page.mouse.move(box.x + box.width / 2, box.y - 40);
	await expect(hint).toHaveCount(0);
	await expect(canvas).toHaveAttribute('data-focus', id);

	// A click on the line opens its ticket, at the overview — rather than
	// scrubbing the board to that moment. Told apart from a same-ticket no-op
	// by parking the panel on another tab first.
	await page.getByRole('button', {name: /^Comments/}).click();
	await expect(page).toHaveURL(/tab=comments/);
	await page.mouse.move(box.x + box.width * 0.7, y);
	await page.mouse.down();
	await page.mouse.up();
	await expect(page).toHaveURL(new RegExp(`/issue/${ref}\\?.*tab=overview`));
	await expect(
		page.getByRole('button', {name: 'Now', exact: true}),
	).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});
