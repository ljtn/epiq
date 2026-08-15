import {beforeEach, describe, expect, it, vi} from 'vitest';
import {ulid} from 'ulid';

vi.mock('../git/git-storage.js', () => ({
	getStateBranchRoot: vi.fn(),
}));

vi.mock('../lib/storage/paths.js', () => ({
	resolveClosestEpiqProjectRoot: vi.fn(),
}));

vi.mock('../lib/event/event-load.js', () => ({
	loadMergedEvents: vi.fn(),
	loadMergedEventsBefore: vi.fn(),
}));

vi.mock('../lib/event/event-materialize.js', () => ({
	materializeAll: vi.fn(),
}));

vi.mock('../lib/state/state.js', () => ({
	getState: vi.fn(),
	isStateInitialized: vi.fn(),
	patchState: vi.fn(),
	resetState: vi.fn(),
}));

vi.mock('../git/git-utils.js', () => ({
	execGit: vi.fn(),
}));

vi.mock('../lib/project-setup/project-setup.js', () => ({
	readProjectFile: vi.fn(),
}));

vi.mock('../lib/editor/editor.js', () => ({
	getEditorCandidates: vi.fn(),
	isVSCodeEditor: vi.fn(),
	openEditorDiffNonBlocking: vi.fn(),
	openEditorOnFileNonBlocking: vi.fn(),
}));

vi.mock('../lib/storage/file-manager.js', () => ({
	fileManager: {
		mkDir: vi.fn(),
		writeToFile: vi.fn(),
	},
}));

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
	chmod: vi.fn(),
}));

import {existsSync} from 'node:fs';
import {chmod} from 'node:fs/promises';
import {getStateBranchRoot} from '../git/git-storage.js';
import {execGit} from '../git/git-utils.js';
import {
	getEditorCandidates,
	isVSCodeEditor,
	openEditorDiffNonBlocking,
	openEditorOnFileNonBlocking,
} from '../lib/editor/editor.js';
import {resolveClosestEpiqProjectRoot} from '../lib/storage/paths.js';
import {
	loadMergedEvents,
	loadMergedEventsBefore,
} from '../lib/event/event-load.js';
import {materializeAll} from '../lib/event/event-materialize.js';
import {readProjectFile} from '../lib/project-setup/project-setup.js';
import {fileManager} from '../lib/storage/file-manager.js';
import {
	getState,
	isStateInitialized,
	patchState,
	resetState,
} from '../lib/state/state.js';
import {
	failed,
	isFail,
	isSuccess,
	succeeded,
} from '../lib/model/result-types.js';
import {
	checkoutStateAt,
	getCommitTimeline,
	getEventTimeline,
	getTimeTravelStatus,
	openCommitDiffInEditor,
	returnToLive,
	runExclusive,
} from '../mcp/epiq-time-travel.js';

describe('epiq-time-travel', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// An ambient global in the real app, so it cannot be vi.mock'd.
		(globalThis as {logger?: unknown}).logger = {
			info: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
		};

		vi.mocked(resolveClosestEpiqProjectRoot).mockReturnValue(
			succeeded('root', '/repo'),
		);

		vi.mocked(getStateBranchRoot).mockReturnValue(
			succeeded('branch', '/repo/.epiq'),
		);

		vi.mocked(resetState).mockReturnValue(succeeded('reset', ''));
		vi.mocked(materializeAll).mockReturnValue([]);

		vi.mocked(readProjectFile).mockReturnValue(
			succeeded('project', {stateBranch: '__epiq_state__'} as never),
		);

		// Non-VS-Code by default, so tests land on the unified-diff fallback.
		vi.mocked(getEditorCandidates).mockReturnValue(['some-editor']);
		vi.mocked(isVSCodeEditor).mockReturnValue(false);
	});

	describe('getTimeTravelStatus', () => {
		it('reports live when state is uninitialized', () => {
			vi.mocked(isStateInitialized).mockReturnValue(false);

			expect(getTimeTravelStatus()).toEqual({mode: 'live', asOfTime: null});
		});

		it('reports live when timeMode is live', () => {
			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'live'} as never);

			expect(getTimeTravelStatus()).toEqual({mode: 'live', asOfTime: null});
		});

		it('reports scrub with the checked-out time after a successful checkout', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: '1'}],
					unappliedEvents: [{id: '2'}],
				} as never),
			);

			await checkoutStateAt({targetTime: 5000});

			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'peek'} as never);

			expect(getTimeTravelStatus()).toEqual({mode: 'scrub', asOfTime: 5000});
		});
	});

	describe('getEventTimeline', () => {
		it('returns an empty timeline when there is no event history', async () => {
			vi.mocked(loadMergedEvents).mockReturnValue(succeeded('events', []));

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.buckets).toEqual([]);
		});

		it('buckets event timestamps decoded from their ULIDs', async () => {
			const baseTime = 1_700_000_000_000;
			const events = [
				{id: ulid(baseTime)},
				{id: ulid(baseTime)},
				{id: ulid(baseTime + 60_000)},
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.earliest).toBe(baseTime);
			const totalCount = result.value.buckets.reduce(
				(sum, bucket) => sum + bucket.count,
				0,
			);
			expect(totalCount).toBe(3);
		});

		it('scopes to an explicit start/end window, excluding events outside it', async () => {
			const baseTime = 1_700_000_000_000;
			const dayMs = 24 * 60 * 60 * 1000;
			const events = [
				{id: ulid(baseTime - dayMs)}, // before the window
				{id: ulid(baseTime + dayMs)}, // inside the window
				{id: ulid(baseTime + 10 * dayMs)}, // after the window
			];

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', events as never),
			);

			const windowStart = baseTime;
			const windowEnd = baseTime + 3 * dayMs;

			const result = await getEventTimeline({
				start: windowStart,
				end: windowEnd,
			});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value.earliest).toBe(windowStart);
			expect(result.value.latest).toBe(windowEnd);

			const totalCount = result.value.buckets.reduce(
				(sum, bucket) => sum + bucket.count,
				0,
			);
			expect(totalCount).toBe(1);
		});

		it('propagates a failure to load events', async () => {
			vi.mocked(loadMergedEvents).mockReturnValue(failed('boom'));

			const result = await getEventTimeline();

			expect(isSuccess(result)).toBe(false);
		});
	});

	describe('getCommitTimeline', () => {
		const SEP = '\x1f';
		const REC = '\x1e';

		it('parses git log --shortstat output into commit entries with linesChanged', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {
					stdout:
						`${REC}aaa111${SEP}1700000000${SEP}Ada${SEP}fix bug\n` +
						` 2 files changed, 45 insertions(+), 12 deletions(-)\n` +
						`${REC}bbb222${SEP}1700000100${SEP}Grace${SEP}add feature\n`,
					stderr: '',
					exitCode: 0,
				}),
			);

			const result = await getCommitTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;

			expect(result.value).toEqual([
				{
					sha: 'aaa111',
					time: 1_700_000_000_000,
					author: 'Ada',
					subject: 'fix bug',
					linesChanged: 57,
				},
				{
					sha: 'bbb222',
					time: 1_700_000_100_000,
					author: 'Grace',
					subject: 'add feature',
					linesChanged: 0,
				},
			]);
		});

		it('excludes the epiq state branch via --not <stateBranch>', async () => {
			vi.mocked(readProjectFile).mockReturnValue(
				succeeded('project', {stateBranch: '__custom_state__'} as never),
			);
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {stdout: '', stderr: '', exitCode: 0}),
			);

			await getCommitTimeline();

			expect(execGit).toHaveBeenCalledWith(
				expect.objectContaining({
					args: expect.arrayContaining(['--not', '__custom_state__']),
				}),
			);
		});

		it('clips the log window to the given start/end via --since/--until', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {stdout: '', stderr: '', exitCode: 0}),
			);

			await getCommitTimeline({
				start: 1_700_000_000_000,
				end: 1_700_000_100_000,
			});

			expect(execGit).toHaveBeenCalledWith(
				expect.objectContaining({
					args: expect.arrayContaining([
						'--since=@1700000000',
						'--until=@1700000100',
					]),
				}),
			);
		});

		it('skips malformed lines missing a sha or timestamp', async () => {
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git log', {
					stdout: `\n${SEP}${SEP}nobody${SEP}no sha or time\n`,
					stderr: '',
					exitCode: 0,
				}),
			);

			const result = await getCommitTimeline();

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;
			expect(result.value).toEqual([]);
		});

		it('propagates a git log failure', async () => {
			vi.mocked(execGit).mockResolvedValue(failed('git not found'));

			const result = await getCommitTimeline();

			expect(isSuccess(result)).toBe(false);
		});
	});

	describe('openCommitDiffInEditor', () => {
		const validSha = 'b42a0bf111e4b6213abf6c1bfe65088b5c9764f8';

		beforeEach(() => {
			vi.mocked(openEditorOnFileNonBlocking).mockResolvedValue(
				succeeded('Opened editor', true),
			);
		});

		it('rejects a sha shaped like a git flag, without ever shelling out', async () => {
			const result = await openCommitDiffInEditor({
				sha: '--upload-pack=/bin/sh',
			});

			expect(isSuccess(result)).toBe(false);
			expect(execGit).not.toHaveBeenCalled();
		});

		it('writes the diff to a sha-named temp file and opens it in the editor', async () => {
			vi.mocked(existsSync).mockReturnValue(false);
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git show', {
					stdout: 'diff --git a/x b/x',
					stderr: '',
					exitCode: 0,
				}),
			);

			const result = await openCommitDiffInEditor({sha: validSha});

			expect(execGit).toHaveBeenCalledWith(
				expect.objectContaining({args: ['show', validSha]}),
			);

			expect(fileManager.writeToFile).toHaveBeenCalledWith(
				expect.stringContaining(`${validSha}.diff`),
				'diff --git a/x b/x',
			);
			expect(chmod).toHaveBeenCalledWith(
				expect.stringContaining(`${validSha}.diff`),
				0o444,
			);
			expect(openEditorOnFileNonBlocking).toHaveBeenCalledWith(
				expect.stringContaining(`${validSha}.diff`),
			);

			expect(isSuccess(result)).toBe(true);
		});

		it('reuses an already-written diff file instead of re-writing it', async () => {
			vi.mocked(existsSync).mockReturnValue(true);
			vi.mocked(execGit).mockResolvedValue(
				succeeded('git show', {stdout: 'irrelevant', stderr: '', exitCode: 0}),
			);

			await openCommitDiffInEditor({sha: validSha});

			expect(fileManager.writeToFile).not.toHaveBeenCalled();
			expect(chmod).not.toHaveBeenCalled();
			expect(openEditorOnFileNonBlocking).toHaveBeenCalled();
		});

		it('propagates a git show failure without touching the filesystem or editor', async () => {
			vi.mocked(execGit).mockResolvedValue(failed('bad object'));

			const result = await openCommitDiffInEditor({sha: validSha});

			expect(isSuccess(result)).toBe(false);
			expect(fileManager.writeToFile).not.toHaveBeenCalled();
			expect(openEditorOnFileNonBlocking).not.toHaveBeenCalled();
		});

		describe('when the resolved editor is VS Code', () => {
			beforeEach(() => {
				vi.mocked(getEditorCandidates).mockReturnValue(['code']);
				vi.mocked(isVSCodeEditor).mockReturnValue(true);
				vi.mocked(existsSync).mockReturnValue(false);
				vi.mocked(openEditorDiffNonBlocking).mockResolvedValue(
					succeeded('Opened editor', true),
				);
			});

			const mockGitForFiles = (
				files: string[],
				contentByPath: Record<string, string> = {},
			) => {
				vi.mocked(execGit).mockImplementation(async ({args}) => {
					if (args[0] === 'diff-tree') {
						return succeeded('changed files', {
							stdout: files.join('\n'),
							stderr: '',
							exitCode: 0,
						});
					}

					if (args[0] === 'show') {
						const spec = args[1] ?? '';

						if (!spec.includes(':')) {
							return succeeded('git show', {
								stdout: 'unified diff fallback content',
								stderr: '',
								exitCode: 0,
							});
						}

						// Omit a spec to simulate a blob missing on that side.
						const content = contentByPath[spec];

						return content === undefined
							? failed('bad object (missing blob)')
							: succeeded('blob', {stdout: content, stderr: '', exitCode: 0});
					}

					return failed(`unexpected git args: ${args.join(' ')}`);
				});
			};

			it('opens one side-by-side diff per changed file, preserving each basename', async () => {
				mockGitForFiles(['source/gui/client/App.tsx', 'source/logger.ts'], {
					[`${validSha}:source/gui/client/App.tsx`]: 'after-app',
					[`${validSha}:source/logger.ts`]: 'after-logger',
				});

				// Fake timers skip the settle delay before the 2nd+ file opens.
				vi.useFakeTimers();
				const pending = openCommitDiffInEditor({sha: validSha});
				await vi.advanceTimersByTimeAsync(1000);
				const result = await pending;
				vi.useRealTimers();

				expect(isSuccess(result)).toBe(true);
				expect(openEditorDiffNonBlocking).toHaveBeenCalledTimes(2);
				expect(openEditorOnFileNonBlocking).not.toHaveBeenCalled();

				const calledPaths = vi
					.mocked(openEditorDiffNonBlocking)
					.mock.calls.map(([, before, after]) => ({before, after}));

				expect(
					calledPaths.some(
						({before, after}) =>
							before.endsWith('/before/App.tsx') &&
							after.endsWith('/after/App.tsx'),
					),
				).toBe(true);
				expect(
					calledPaths.some(
						({before, after}) =>
							before.endsWith('/before/logger.ts') &&
							after.endsWith('/after/logger.ts'),
					),
				).toBe(true);
			});

			it('opens the first file in a new window and the rest reused into it', async () => {
				mockGitForFiles(['source/a.ts', 'source/b.ts', 'source/c.ts'], {
					[`${validSha}:source/a.ts`]: 'a',
					[`${validSha}:source/b.ts`]: 'b',
					[`${validSha}:source/c.ts`]: 'c',
				});

				vi.useFakeTimers();
				const pending = openCommitDiffInEditor({sha: validSha});
				await vi.advanceTimersByTimeAsync(1000);
				await pending;
				vi.useRealTimers();

				const windowModes = vi
					.mocked(openEditorDiffNonBlocking)
					.mock.calls.map(([, , , windowMode]) => windowMode);

				expect(windowModes.filter(mode => mode === 'new')).toHaveLength(1);
				expect(windowModes.filter(mode => mode === 'reuse')).toHaveLength(2);
			});

			it('stays a success even if a later file fails to join the new window', async () => {
				mockGitForFiles(['source/a.ts', 'source/b.ts'], {
					[`${validSha}:source/a.ts`]: 'a',
					[`${validSha}:source/b.ts`]: 'b',
				});
				vi.mocked(openEditorDiffNonBlocking).mockImplementation(
					async (_editor, _before, _after, windowMode) =>
						windowMode === 'new'
							? succeeded('Opened editor', true)
							: failed('"code" exited with code 1'),
				);

				vi.useFakeTimers();
				const pending = openCommitDiffInEditor({sha: validSha});
				await vi.advanceTimersByTimeAsync(1000);
				const result = await pending;
				vi.useRealTimers();

				expect(isSuccess(result)).toBe(true);
			});

			it("doesn't wait for the settle delay when the commit touches only one file", async () => {
				mockGitForFiles(['source/a.ts'], {
					[`${validSha}:source/a.ts`]: 'a',
				});

				const result = await openCommitDiffInEditor({sha: validSha});

				expect(isSuccess(result)).toBe(true);
				expect(openEditorDiffNonBlocking).toHaveBeenCalledTimes(1);
				expect(openEditorDiffNonBlocking).toHaveBeenCalledWith(
					'code',
					expect.any(String),
					expect.any(String),
					'new',
				);
			});

			it('treats a missing blob (file added or deleted at this commit) as empty content, not a failure', async () => {
				mockGitForFiles(['source/new-file.ts'], {
					// No "before" spec: the file did not exist at this commit.
					[`${validSha}:source/new-file.ts`]: 'brand new content',
				});

				const result = await openCommitDiffInEditor({sha: validSha});

				expect(isSuccess(result)).toBe(true);
				expect(fileManager.writeToFile).toHaveBeenCalledWith(
					expect.stringContaining('/before/new-file.ts'),
					'',
				);
				expect(fileManager.writeToFile).toHaveBeenCalledWith(
					expect.stringContaining('/after/new-file.ts'),
					'brand new content',
				);
			});

			it('falls back to the unified diff when the commit touches too many files', async () => {
				const manyFiles = Array.from(
					{length: 13},
					(_, i) => `source/file-${i}.ts`,
				);
				mockGitForFiles(manyFiles);
				vi.mocked(openEditorOnFileNonBlocking).mockResolvedValue(
					succeeded('Opened editor', true),
				);

				await openCommitDiffInEditor({sha: validSha});

				expect(openEditorDiffNonBlocking).not.toHaveBeenCalled();
				expect(openEditorOnFileNonBlocking).toHaveBeenCalled();
			});

			it('falls back to the unified diff when every side-by-side open fails', async () => {
				mockGitForFiles(['source/x.ts'], {
					[`${validSha}:source/x.ts`]: 'content',
				});
				vi.mocked(openEditorDiffNonBlocking).mockResolvedValue(
					failed('"code" exited with code 1'),
				);
				vi.mocked(openEditorOnFileNonBlocking).mockResolvedValue(
					succeeded('Opened editor', true),
				);

				const result = await openCommitDiffInEditor({sha: validSha});

				expect(openEditorOnFileNonBlocking).toHaveBeenCalled();
				expect(isSuccess(result)).toBe(true);
			});
		});
	});

	describe('checkoutStateAt', () => {
		it('materializes events before the target time and marks state read-only', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: '1'}],
					unappliedEvents: [{id: '2'}],
				} as never),
			);

			const result = await checkoutStateAt({targetTime: 1234});

			expect(loadMergedEventsBefore).toHaveBeenCalledWith('/repo/.epiq', 1234);
			expect(resetState).toHaveBeenCalled();
			expect(materializeAll).toHaveBeenCalledWith([{id: '1'}]);

			expect(patchState).toHaveBeenCalledWith({
				readOnly: true,
				timeMode: 'peek',
				unappliedEvents: [{id: '2'}],
				replay: null,
			});

			expect(isSuccess(result)).toBe(true);
			if (isFail(result)) return;
			expect(result.value.asOfTime).toBe(1234);
		});

		it('fails without checking out a historical state when materialization fails', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: '1'}],
					unappliedEvents: [],
				} as never),
			);

			vi.mocked(materializeAll).mockReturnValue([failed('boom')]);

			const result = await checkoutStateAt({targetTime: 1234});

			expect(isSuccess(result)).toBe(false);
			expect(patchState).not.toHaveBeenCalledWith(
				expect.objectContaining({timeMode: 'peek'}),
			);
		});

		// resetState runs before materializing, so a failure must degrade to
		// "live" rather than leave an empty board that reads as writable.
		it('re-materializes the live head and marks state live when materialization fails', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: 'old'}],
					unappliedEvents: [{id: 'new'}],
				} as never),
			);
			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', [{id: 'old'}, {id: 'new'}] as never),
			);

			// Only the historical slice fails; the head still materializes.
			vi.mocked(materializeAll).mockImplementation(events =>
				events.length === 1 ? [failed('boom')] : [],
			);

			const result = await checkoutStateAt({targetTime: 1234});

			expect(isSuccess(result)).toBe(false);
			expect(materializeAll).toHaveBeenCalledWith([{id: 'old'}, {id: 'new'}]);
			expect(patchState).toHaveBeenCalledWith({
				readOnly: false,
				timeMode: 'live',
				unappliedEvents: [],
				replay: null,
			});
		});

		it('clears the tracked as-of time when materialization fails', async () => {
			// Sets the as-of clock, which the failing checkout must clear.
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [],
					unappliedEvents: [],
				} as never),
			);
			await checkoutStateAt({targetTime: 777});

			vi.mocked(loadMergedEvents).mockReturnValue(succeeded('events', []));
			vi.mocked(materializeAll).mockImplementation(events =>
				events.length === 1 ? [failed('boom')] : [],
			);
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: 'old'}],
					unappliedEvents: [],
				} as never),
			);

			await checkoutStateAt({targetTime: 1234});

			// The clock is only observable down the non-live branch.
			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'peek'} as never);

			expect(getTimeTravelStatus().asOfTime).toBeNull();
		});

		it('reports the original failure first when the recovery to live also fails', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: 'old'}],
					unappliedEvents: [],
				} as never),
			);
			vi.mocked(materializeAll).mockReturnValue([failed('boom')]);
			vi.mocked(loadMergedEvents).mockReturnValue(failed('log unreadable'));

			const result = await checkoutStateAt({targetTime: 1234});

			expect(isSuccess(result)).toBe(false);
			expect(result.message).toContain('boom');
			expect(result.message).toContain('log unreadable');
			expect(result.message.indexOf('boom')).toBeLessThan(
				result.message.indexOf('log unreadable'),
			);
		});
	});

	describe('returnToLive', () => {
		it('re-materializes the full event log and marks state live', async () => {
			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', [{id: '1'}, {id: '2'}] as never),
			);

			const result = await returnToLive();

			expect(materializeAll).toHaveBeenCalledWith([{id: '1'}, {id: '2'}]);

			expect(patchState).toHaveBeenCalledWith({
				readOnly: false,
				timeMode: 'live',
				unappliedEvents: [],
				replay: null,
			});

			expect(isSuccess(result)).toBe(true);
		});

		it('clears the tracked as-of time so status reports live again', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [],
					unappliedEvents: [],
				} as never),
			);
			await checkoutStateAt({targetTime: 999});

			vi.mocked(loadMergedEvents).mockReturnValue(succeeded('events', []));
			await returnToLive();

			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'live'} as never);

			expect(getTimeTravelStatus()).toEqual({mode: 'live', asOfTime: null});
		});

		// Live flags plus a stale as-of clock is the incoherence to avoid.
		it('clears the tracked as-of time when materialization fails', async () => {
			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [],
					unappliedEvents: [],
				} as never),
			);
			await checkoutStateAt({targetTime: 4242});

			vi.mocked(loadMergedEvents).mockReturnValue(
				succeeded('events', [{id: '1'}] as never),
			);
			vi.mocked(materializeAll).mockReturnValue([failed('boom')]);

			const result = await returnToLive();

			expect(isSuccess(result)).toBe(false);
			expect(result.message).toContain('boom');
			expect(patchState).not.toHaveBeenCalledWith(
				expect.objectContaining({timeMode: 'live'}),
			);

			// The clock is only observable down the non-live branch.
			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'peek'} as never);

			expect(getTimeTravelStatus().asOfTime).toBeNull();
		});
	});

	describe('runExclusive', () => {
		it('serializes overlapping operations instead of running them concurrently', async () => {
			const log: string[] = [];

			const first = runExclusive(async () => {
				log.push('first:start');
				await new Promise(resolve => setTimeout(resolve, 20));
				log.push('first:end');
			});

			const second = runExclusive(async () => {
				log.push('second:start');
				log.push('second:end');
			});

			await Promise.all([first, second]);

			expect(log).toEqual([
				'first:start',
				'first:end',
				'second:start',
				'second:end',
			]);
		});

		it('still runs a queued operation after an earlier one rejects', async () => {
			const first = runExclusive(async () => {
				throw new Error('boom');
			});

			let secondRan = false;
			const second = runExclusive(async () => {
				secondRan = true;
			});

			await expect(first).rejects.toThrow('boom');
			await second;

			expect(secondRan).toBe(true);
		});

		// A sync holding the lock must finish everything after its own await
		// before a queued checkout runs, or the scrub is clobbered.
		it("a checkout queued during an in-flight exclusive op waits for it, so it can't be clobbered", async () => {
			vi.mocked(isStateInitialized).mockReturnValue(true);
			vi.mocked(getState).mockReturnValue({timeMode: 'live'} as never);

			const log: string[] = [];
			let releaseSync: () => void = () => {};
			const syncGate = new Promise<void>(resolve => {
				releaseSync = resolve;
			});

			const fakeAutosyncTick = runExclusive(async () => {
				log.push('sync:start');
				await syncGate; // simulates the git round-trip
				log.push('sync:end');
			});

			vi.mocked(loadMergedEventsBefore).mockReturnValue(
				succeeded('events', {
					appliedEvents: [{id: '1'}],
					unappliedEvents: [],
				} as never),
			);

			const checkout = checkoutStateAt({targetTime: 1234}).then(result => {
				log.push('checkout:done');
				return result;
			});

			await new Promise(resolve => setTimeout(resolve, 10));
			expect(log).toEqual(['sync:start']);
			expect(patchState).not.toHaveBeenCalled();

			releaseSync();
			await fakeAutosyncTick;
			const result = await checkout;

			expect(log).toEqual(['sync:start', 'sync:end', 'checkout:done']);
			expect(isSuccess(result)).toBe(true);
		});
	});
});
