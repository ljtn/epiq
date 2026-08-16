import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execSync} from 'node:child_process';
import {expect, test} from './fixtures.js';
import {HANDOFF_PATH, type Handoff} from './handoff.js';

// Every mutation schedules a sync, and `runSync` ignores the autoSync setting.
// Without an origin that sync fails instantly, so the fixture never exercises
// the commit/rebase/push the real app runs after every move.
const givenARemote = (repoRoot: string) => {
	const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-remote-'));
	execSync(`git init --bare -b main "${bare}"`, {stdio: 'ignore'});
	execSync(`git -C "${repoRoot}" remote add origin "${bare}"`, {
		stdio: 'ignore',
	});

	return bare;
};

const SCRIPT = `
new Promise(async resolve => {
	const ws = new WebSocket('ws://' + window.location.host + '/ws');
	let latest = null;
	const results = [];

	ws.addEventListener('message', event => {
		const msg = JSON.parse(event.data);
		if (msg.type === 'state') latest = msg.payload?.value ?? null;
		if (msg.type === 'issues:move:result') results.push(msg.payload.status);
	});

	const send = b => ws.send(JSON.stringify(b));
	const wait = ms => new Promise(r => setTimeout(r, ms));
	const laneOf = (state, title) => {
		for (const lane of state.boards[0].swimlanes) {
			if (lane.issues.some(i => i.title === title)) return lane.title;
		}
		return null;
	};

	await new Promise(r => ws.addEventListener('open', r));
	send({type: 'state:get'});
	await wait(1500);

	const tag = 'S' + Math.floor(Math.random() * 1e6);
	const [from, to] = latest.boards[0].swimlanes;
	const titles = [];

	for (let n = 0; n < 6; n++) {
		const title = tag + '-' + n;
		titles.push(title);
		send({type: 'issues:create', payload: {parentId: from.id, title}});
		await wait(1500);
	}

	send({type: 'state:get'});
	await wait(1500);

	const outcomes = [];

	for (const title of titles) {
		const issue = latest.boards[0].swimlanes
			.flatMap(l => l.issues)
			.find(i => i.title === title);

		send({
			type: 'issues:move',
			payload: {issueId: issue.id, parentId: to.id, position: {at: 'end'}},
		});

		// Fired close together, so each move lands while the previous one's sync
		// is still running.
		await wait(250);
	}

	await wait(8000);
	send({type: 'state:get'});
	await wait(1500);

	for (const title of titles) {
		outcomes.push({title, lane: laneOf(latest, title), want: to.title});
	}

	resolve({outcomes, results});
})
`;

test.setTimeout(240_000);

test('moves survive the sync each one schedules', async ({page, appUrl}) => {
	const {repoRoot} = JSON.parse(
		fs.readFileSync(HANDOFF_PATH, 'utf8'),
	) as Handoff;

	givenARemote(repoRoot);

	await page.goto(appUrl);
	await expect(page.getByTestId('board-switcher')).toContainText('Default');

	const {outcomes, results} = await page.evaluate<{
		outcomes: {title: string; lane: string | null; want: string}[];
		results: string[];
	}>(SCRIPT);

	console.log('[move results]', JSON.stringify(results));
	for (const outcome of outcomes) {
		const ok = outcome.lane === outcome.want;
		console.log(
			`  ${ok ? 'OK  ' : 'FAIL'} ${outcome.title} -> ${outcome.lane}`,
		);
	}

	execSync(`git -C "${repoRoot}" remote remove origin`, {stdio: 'ignore'});

	const failures = outcomes.filter(o => o.lane !== o.want);
	expect(failures, JSON.stringify(failures)).toHaveLength(0);
});
