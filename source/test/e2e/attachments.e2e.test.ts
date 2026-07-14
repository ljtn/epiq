import {execSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {getStateBranchRoot} from '../../git/git-storage.js';
import {startGuiServer} from '../../gui/api/api-server.js';
import {loadMergedEvents} from '../../lib/event/event-load.js';
import {getMediaDirPath} from '../../lib/storage/paths.js';
import {isFail} from '../../lib/model/result-types.js';
import {readProjectFile} from '../../lib/project-setup/project-setup.js';
import {
	addIssueAttachment,
	deleteIssueAttachment,
	getGuiState,
	listIssues,
	sync,
} from '../../mcp/epiq-api.js';
import {commonSteps} from './e2e-common-steps.js';
import {ARROW_DOWN, ENTER, setupTui} from './e2e.helper.js';

const testTimeout = 60_000;
const EMPTY_CMD = 'for command line';

const PNG_1PX = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64',
);

type Tui = ReturnType<typeof setupTui>;

const run = async (tui: Tui, cmd: string, echo: string) => {
	tui.input(cmd);
	await tui.waitFor(echo, 4_000);
	tui.input(ENTER);
	await tui.waitFor(EMPTY_CMD, 5_000);
};

const httpRequest = async (
	base: string,
	method: string,
	pathName: string,
	body?: unknown,
): Promise<{status: number; headers: http.IncomingHttpHeaders; body: Buffer}> =>
	new Promise((resolve, reject) => {
		const request = http.request(
			`${base}${pathName}`,
			{
				method,
				headers: body ? {'content-type': 'application/json'} : {},
			},
			response => {
				const chunks: Buffer[] = [];
				response.on('data', chunk => chunks.push(chunk));
				response.on('end', () =>
					resolve({
						status: response.statusCode ?? 0,
						headers: response.headers,
						body: Buffer.concat(chunks),
					}),
				);
			},
		);

		request.on('error', reject);
		if (body) request.write(JSON.stringify(body));
		request.end();
	});

describe('issue attachments', () => {
	let repoRoot: string;
	let remoteDir: string;
	let stateRoot: string;
	let issueId: string;
	let cleanupTui: (() => void) | null = null;

	beforeAll(async () => {
		const setupTuiSession = setupTui();

		try {
			await commonSteps.configureInitialSettings(setupTuiSession);
		} finally {
			setupTuiSession.destroy();
		}

		// Bootstrap a real project and one issue through the actual TUI, then
		// hand the repo over to the API layer. Passing an explicit cwd keeps
		// the directory alive after destroy() (the session only removes
		// directories it created itself).
		repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-attach-'));
		const tui = setupTui([], {cwd: repoRoot});
		cleanupTui = tui.destroy;

		await commonSteps.init(tui);

		// Enter the default board first — :new issue is context-aware.
		tui.input(ENTER);
		await tui.waitFor('Todo (0)');

		await run(tui, ':new issue Attachment target', 'new issue Attachment');
		await tui.waitFor('Todo (1)', 4_000);
		tui.destroy();
		cleanupTui = null;

		// Remote is added after the TUI exits so background auto-sync cannot
		// race the explicit sync assertions below.
		remoteDir = path.join(repoRoot, '..', `${path.basename(repoRoot)}-remote`);
		execSync(`git init --bare "${remoteDir}"`, {stdio: 'ignore'});
		execSync(`git remote add origin "${remoteDir}"`, {
			cwd: repoRoot,
			stdio: 'ignore',
		});

		const stateRootResult = getStateBranchRoot({repoRoot});
		if (isFail(stateRootResult)) throw new Error(stateRootResult.message);
		stateRoot = stateRootResult.value;

		const issues = await listIssues({repoRoot});
		if (isFail(issues)) throw new Error(issues.message);

		const issue = issues.value.find(
			candidate => candidate.title === 'Attachment target',
		);
		if (!issue) throw new Error('Bootstrap issue not found');
		issueId = issue.id;
	}, testTimeout);

	afterAll(() => {
		cleanupTui?.();
		fs.rmSync(repoRoot, {recursive: true, force: true});
		fs.rmSync(remoteDir, {recursive: true, force: true});
	});

	it(
		'uploads, exposes, serves, deletes, and syncs attachments',
		async () => {
			// --- upload through the API layer
			const added = await addIssueAttachment({
				repoRoot,
				issueId,
				name: 'screenshot.png',
				dataBase64: PNG_1PX.toString('base64'),
			});

			expect(isFail(added)).toBe(false);
			if (isFail(added)) return;

			const {fileName} = added.value;
			const blobPath = path.join(getMediaDirPath(stateRoot), fileName);
			expect(fs.existsSync(blobPath)).toBe(true);
			expect(fs.readFileSync(blobPath).equals(PNG_1PX)).toBe(true);

			// --- exposed in GUI state with ownership and the configured cap
			const state = await getGuiState({repoRoot});
			expect(isFail(state)).toBe(false);
			if (isFail(state)) return;

			const exposed = state.value.attachmentsByIssueId[issueId] ?? [];
			expect(exposed).toHaveLength(1);
			expect(exposed[0]).toMatchObject({
				fileName,
				name: 'screenshot.png',
				bytes: PNG_1PX.length,
				canDelete: true,
			});
			expect(state.value.attachmentMaxKb).toBe(500);

			// --- served over real HTTP
			const serverResult = await startGuiServer({repoRoot, boardId: ''});
			expect(isFail(serverResult)).toBe(false);
			if (isFail(serverResult)) return;

			const {server} = serverResult.value;
			const address = server.address();
			if (!address || typeof address === 'string') {
				throw new Error('No server address');
			}
			const base = `http://127.0.0.1:${address.port}`;

			try {
				const served = await httpRequest(base, 'GET', `/media/${fileName}`);
				expect(served.status).toBe(200);
				expect(served.headers['content-type']).toBe('image/png');
				expect(served.headers['cache-control']).toContain('immutable');
				expect(served.body.equals(PNG_1PX)).toBe(true);

				// unknown and malformed names are refused
				const missing = await httpRequest(
					base,
					'GET',
					`/media/${'0'.repeat(64)}.png`,
				);
				expect(missing.status).toBe(404);

				const traversal = await httpRequest(
					base,
					'GET',
					'/media/..%2F..%2Fproject.json',
				);
				expect(traversal.status).toBe(404);

				// a spoofed synced blob (valid name, foreign content) is not served
				const spoofedName = `${'b'.repeat(64)}.png`;
				fs.writeFileSync(
					path.join(getMediaDirPath(stateRoot), spoofedName),
					PNG_1PX,
				);
				const spoofed = await httpRequest(base, 'GET', `/media/${spoofedName}`);
				expect(spoofed.status).toBe(404);

				// oversized upload is rejected with the size-cap message
				const oversized = Buffer.concat([PNG_1PX, Buffer.alloc(600 * 1024)]);
				const rejected = await httpRequest(base, 'POST', '/api/attachments', {
					issueId,
					name: 'huge.png',
					dataBase64: oversized.toString('base64'),
				});
				expect(rejected.status).toBe(400);
				expect(rejected.body.toString()).toContain('size cap');

				// non-image bytes are rejected
				const garbage = await httpRequest(base, 'POST', '/api/attachments', {
					issueId,
					name: 'note.txt',
					dataBase64: Buffer.from('just some text').toString('base64'),
				});
				expect(garbage.status).toBe(400);
			} finally {
				server.close();
			}

			// --- the TUI shows attachments in the issue details view
			const indicatorTui = setupTui([], {cwd: repoRoot});
			try {
				await indicatorTui.waitFor('Attachment target', 10_000);

				// enter the issue: an Attachments section with selectable nodes
				indicatorTui.input(ENTER);
				const detailsFrame = await indicatorTui.waitFor(
					'Attachments (1)',
					8_000,
				);
				expect(detailsFrame).toContain('Attachments (1)');

				// last row in the details tree — walk down and enter it
				for (let i = 0; i < 5; i++) indicatorTui.input(ARROW_DOWN);
				indicatorTui.input(ENTER);
				const listFrame = await indicatorTui.waitFor('enter to open', 8_000);
				expect(listFrame).toContain('screenshot.png');

				// enter delegates to the system opener; the TUI must stay alive
				// even where no opener exists (this container)
				indicatorTui.input(ENTER);
				const afterOpen = await indicatorTui.waitFor('screenshot.png', 4_000);
				expect(afterOpen).toContain('screenshot.png');
			} finally {
				indicatorTui.destroy();
			}

			// --- delete removes the reference but never the blob (time travel)
			const deleted = await deleteIssueAttachment({
				repoRoot,
				attachmentId: added.value.id,
			});
			expect(isFail(deleted)).toBe(false);

			const afterDelete = await getGuiState({repoRoot});
			expect(isFail(afterDelete)).toBe(false);
			if (isFail(afterDelete)) return;
			expect(
				afterDelete.value.attachmentsByIssueId[issueId] ?? [],
			).toHaveLength(0);
			expect(fs.existsSync(blobPath)).toBe(true);

			// both events remain in the log for peek/replay
			const events = loadMergedEvents(stateRoot);
			expect(isFail(events)).toBe(false);
			if (isFail(events)) return;
			const actions = events.value.map(event => event.action);
			expect(actions).toContain('add.issue.attachment');
			expect(actions).toContain('delete.issue.attachment');

			// --- sync pushes blob and events in the same state branch, so a
			// teammate's pull receives the image with the event that references it
			const synced = await sync({repoRoot});
			expect(isFail(synced)).toBe(false);

			const projectResult = readProjectFile(repoRoot);
			expect(isFail(projectResult)).toBe(false);
			if (isFail(projectResult)) return;

			const remoteFiles = execSync(
				`git --git-dir="${remoteDir}" ls-tree -r --name-only "${projectResult.value.stateBranch}"`,
				{encoding: 'utf8'},
			);
			expect(remoteFiles).toContain(`.epiq/media/${fileName}`);
			expect(remoteFiles).toContain('.epiq/events/');
		},
		testTimeout,
	);
});
