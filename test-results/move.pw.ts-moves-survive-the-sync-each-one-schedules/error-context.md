# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: move.pw.ts >> moves survive the sync each one schedules
- Location: source/test/e2e-gui/move.pw.ts:91:1

# Error details

```
Error: page.evaluate: Target page, context or browser has been closed
```

# Test source

```ts
  1   | import fs from 'node:fs';
  2   | import os from 'node:os';
  3   | import path from 'node:path';
  4   | import {execSync} from 'node:child_process';
  5   | import {expect, test} from './fixtures.js';
  6   | import {HANDOFF_PATH, type Handoff} from './handoff.js';
  7   | 
  8   | // Every mutation schedules a sync, and `runSync` ignores the autoSync setting.
  9   | // Without an origin that sync fails instantly, so the fixture never exercises
  10  | // the commit/rebase/push the real app runs after every move.
  11  | const givenARemote = (repoRoot: string) => {
  12  | 	const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-remote-'));
  13  | 	execSync(`git init --bare -b main "${bare}"`, {stdio: 'ignore'});
  14  | 	execSync(`git -C "${repoRoot}" remote add origin "${bare}"`, {
  15  | 		stdio: 'ignore',
  16  | 	});
  17  | 
  18  | 	return bare;
  19  | };
  20  | 
  21  | const SCRIPT = `
  22  | new Promise(async resolve => {
  23  | 	const ws = new WebSocket('ws://' + window.location.host + '/ws');
  24  | 	let latest = null;
  25  | 	const results = [];
  26  | 
  27  | 	ws.addEventListener('message', event => {
  28  | 		const msg = JSON.parse(event.data);
  29  | 		if (msg.type === 'state') latest = msg.payload?.value ?? null;
  30  | 		if (msg.type === 'issues:move:result') results.push(msg.payload.status);
  31  | 	});
  32  | 
  33  | 	const send = b => ws.send(JSON.stringify(b));
  34  | 	const wait = ms => new Promise(r => setTimeout(r, ms));
  35  | 	const laneOf = (state, title) => {
  36  | 		for (const lane of state.boards[0].swimlanes) {
  37  | 			if (lane.issues.some(i => i.title === title)) return lane.title;
  38  | 		}
  39  | 		return null;
  40  | 	};
  41  | 
  42  | 	await new Promise(r => ws.addEventListener('open', r));
  43  | 	send({type: 'state:get'});
  44  | 	await wait(1500);
  45  | 
  46  | 	const tag = 'S' + Math.floor(Math.random() * 1e6);
  47  | 	const [from, to] = latest.boards[0].swimlanes;
  48  | 	const titles = [];
  49  | 
  50  | 	for (let n = 0; n < 6; n++) {
  51  | 		const title = tag + '-' + n;
  52  | 		titles.push(title);
  53  | 		send({type: 'issues:create', payload: {parentId: from.id, title}});
  54  | 		await wait(1500);
  55  | 	}
  56  | 
  57  | 	send({type: 'state:get'});
  58  | 	await wait(1500);
  59  | 
  60  | 	const outcomes = [];
  61  | 
  62  | 	for (const title of titles) {
  63  | 		const issue = latest.boards[0].swimlanes
  64  | 			.flatMap(l => l.issues)
  65  | 			.find(i => i.title === title);
  66  | 
  67  | 		send({
  68  | 			type: 'issues:move',
  69  | 			payload: {issueId: issue.id, parentId: to.id, position: {at: 'end'}},
  70  | 		});
  71  | 
  72  | 		// Fired close together, so each move lands while the previous one's sync
  73  | 		// is still running.
  74  | 		await wait(250);
  75  | 	}
  76  | 
  77  | 	await wait(8000);
  78  | 	send({type: 'state:get'});
  79  | 	await wait(1500);
  80  | 
  81  | 	for (const title of titles) {
  82  | 		outcomes.push({title, lane: laneOf(latest, title), want: to.title});
  83  | 	}
  84  | 
  85  | 	resolve({outcomes, results});
  86  | })
  87  | `;
  88  | 
  89  | test.setTimeout(240_000);
  90  | 
  91  | test('moves survive the sync each one schedules', async ({page, appUrl}) => {
  92  | 	const {repoRoot} = JSON.parse(
  93  | 		fs.readFileSync(HANDOFF_PATH, 'utf8'),
  94  | 	) as Handoff;
  95  | 
  96  | 	givenARemote(repoRoot);
  97  | 
  98  | 	await page.goto(appUrl);
  99  | 	await expect(page.getByTestId('board-switcher')).toContainText('Default');
  100 | 
> 101 | 	const {outcomes, results} = await page.evaluate<{
      |                                         ^ Error: page.evaluate: Target page, context or browser has been closed
  102 | 		outcomes: {title: string; lane: string | null; want: string}[];
  103 | 		results: string[];
  104 | 	}>(SCRIPT);
  105 | 
  106 | 	console.log('[move results]', JSON.stringify(results));
  107 | 	for (const outcome of outcomes) {
  108 | 		const ok = outcome.lane === outcome.want;
  109 | 		console.log(
  110 | 			`  ${ok ? 'OK  ' : 'FAIL'} ${outcome.title} -> ${outcome.lane}`,
  111 | 		);
  112 | 	}
  113 | 
  114 | 	execSync(`git -C "${repoRoot}" remote remove origin`, {stdio: 'ignore'});
  115 | 
  116 | 	const failures = outcomes.filter(o => o.lane !== o.want);
  117 | 	expect(failures, JSON.stringify(failures)).toHaveLength(0);
  118 | });
  119 | 
```