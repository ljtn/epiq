import {EventEmitter} from 'node:events';
import {beforeEach, describe, expect, it, vi} from 'vitest';

vi.mock('node:child_process', () => ({
	spawn: vi.fn(),
	spawnSync: vi.fn(),
}));

vi.mock('../lib/state/settings.state.js', () => ({
	getSettingsState: vi.fn(),
}));

vi.mock('../lib/storage/file-manager.js', () => ({
	fileManager: {
		mkDir: vi.fn(),
		writeToFile: vi.fn(),
		readFile: vi.fn(),
	},
}));

import {spawn} from 'node:child_process';
import {getSettingsState} from '../lib/state/settings.state.js';
import {isFail, isSuccess} from '../lib/model/result-types.js';
import {
	buildEditorDiffCommand,
	openEditorDiffNonBlocking,
	openEditorOnFileNonBlocking,
} from '../lib/editor/editor.js';

// Fake enough of a ChildProcess for trySpawnEditor's purposes: it only ever
// touches `.on('error'|'exit', ...)` and `.unref()`.
class FakeChild extends EventEmitter {
	unref = vi.fn();
}

describe('openEditorOnFileNonBlocking', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();

		// `logger` is an ambient global (source/logger.ts assigns it onto
		// globalThis as an import side effect in the real app) rather than a
		// module this file can vi.mock — stub it directly so trySpawnEditor's
		// failure-path logging doesn't throw ReferenceError in isolation.
		(globalThis as {logger?: unknown}).logger = {
			info: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
		};

		vi.mocked(getSettingsState).mockReturnValue({
			preferredEditor: null,
			logLevel: 'info',
			autoSyncIntervalMs: null,
			attachmentMaxKb: null,
			autoSync: null,
			userName: null,
			userId: null,
			viewMode: null,
		});

		delete process.env['VISUAL'];
		delete process.env['EDITOR'];
	});

	it('fails without spawning anything when no editor is configured', async () => {
		const result = await openEditorOnFileNonBlocking('/tmp/x.diff');

		expect(isFail(result)).toBe(true);
		expect(spawn).not.toHaveBeenCalled();
	});

	it('succeeds once the spawned command exits 0', async () => {
		process.env['EDITOR'] = 'code';
		const child = new FakeChild();
		vi.mocked(spawn).mockReturnValue(child as never);

		const pending = openEditorOnFileNonBlocking('/tmp/x.diff');
		child.emit('exit', 0);

		const result = await pending;
		expect(isSuccess(result)).toBe(true);
	});

	it('reports a failure (instead of a false success) when the command exits non-zero', async () => {
		// Reproduces the reported bug: a `preferredEditor` that resolves to a
		// broken shell command (e.g. a literal "$EDITOR" placeholder with no
		// env var set) used to be reported as success just because the shell
		// itself spawned fine — the user saw nothing happen with no error.
		process.env['EDITOR'] = '$EDITOR';
		const child = new FakeChild();
		vi.mocked(spawn).mockReturnValue(child as never);

		const pending = openEditorOnFileNonBlocking('/tmp/x.diff');
		child.emit('exit', 127);

		const result = await pending;
		expect(isFail(result)).toBe(true);
		if (isSuccess(result)) return;
		expect(result.message).toContain('127');
	});

	it('fails when the child process itself errors to spawn', async () => {
		process.env['EDITOR'] = 'nonexistent-binary';
		const child = new FakeChild();
		vi.mocked(spawn).mockReturnValue(child as never);

		const pending = openEditorOnFileNonBlocking('/tmp/x.diff');
		child.emit('error', new Error('spawn ENOENT'));

		const result = await pending;
		expect(isFail(result)).toBe(true);
	});

	it('assumes success for a command still running past the grace window', async () => {
		vi.useFakeTimers();
		process.env['EDITOR'] = 'some-gui-editor';
		const child = new FakeChild();
		vi.mocked(spawn).mockReturnValue(child as never);

		const pending = openEditorOnFileNonBlocking('/tmp/x.diff');
		await vi.advanceTimersByTimeAsync(1000);

		const result = await pending;
		expect(isSuccess(result)).toBe(true);
		expect(child.unref).toHaveBeenCalled();
		vi.useRealTimers();
	});

	it.each(['vim', 'vi', 'nvim', 'nano', '/usr/bin/vim'])(
		'fails fast, without spawning, for the terminal editor %s',
		async editor => {
			// Reproduces the reported "still nothing happens" follow-up: the
			// server-side fixes made a broken command fail loudly, but a
			// *working* terminal editor (vim, vi, ...) spawned detached with
			// stdio:'ignore' has no terminal to attach to — it either errors
			// invisibly or just sits there, so the user still sees nothing.
			process.env['EDITOR'] = editor;

			const result = await openEditorOnFileNonBlocking('/tmp/x.diff');

			expect(isFail(result)).toBe(true);
			expect(spawn).not.toHaveBeenCalled();
			if (isSuccess(result)) return;
			expect(result.message).toContain('terminal editor');
			expect(result.message).toContain('/tmp/x.diff');
		},
	);

	it('falls back past a terminal-only editor to the next working candidate', async () => {
		vi.mocked(getSettingsState).mockReturnValue({
			preferredEditor: 'vim',
			logLevel: 'info',
			autoSyncIntervalMs: null,
			attachmentMaxKb: null,
			autoSync: null,
			userName: null,
			userId: null,
			viewMode: null,
		});
		process.env['EDITOR'] = 'code';

		const child = new FakeChild();
		vi.mocked(spawn).mockReturnValue(child as never);

		const pending = openEditorOnFileNonBlocking('/tmp/x.diff');
		child.emit('exit', 0);

		const result = await pending;
		expect(isSuccess(result)).toBe(true);
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(spawn).toHaveBeenCalledWith(
			expect.stringContaining('code'),
			expect.anything(),
		);
	});

	it('falls back to the next candidate after an earlier one fails', async () => {
		vi.mocked(getSettingsState).mockReturnValue({
			preferredEditor: 'broken-editor',
			logLevel: 'info',
			autoSyncIntervalMs: null,
			attachmentMaxKb: null,
			autoSync: null,
			userName: null,
			userId: null,
			viewMode: null,
		});
		process.env['EDITOR'] = 'code';

		const firstChild = new FakeChild();
		const secondChild = new FakeChild();
		vi.mocked(spawn)
			.mockReturnValueOnce(firstChild as never)
			.mockReturnValueOnce(secondChild as never);

		const pending = openEditorOnFileNonBlocking('/tmp/x.diff');
		firstChild.emit('exit', 1);
		await Promise.resolve();
		await Promise.resolve();
		secondChild.emit('exit', 0);

		const result = await pending;
		expect(isSuccess(result)).toBe(true);
		expect(spawn).toHaveBeenCalledTimes(2);
	});
});

describe('buildEditorDiffCommand', () => {
	it('defaults to --new-window', () => {
		expect(buildEditorDiffCommand('code', '/tmp/before', '/tmp/after')).toBe(
			'code --new-window --diff "/tmp/before" "/tmp/after"',
		);
	});

	it('uses --reuse-window when asked', () => {
		expect(
			buildEditorDiffCommand('code', '/tmp/before', '/tmp/after', 'reuse'),
		).toBe('code --reuse-window --diff "/tmp/before" "/tmp/after"');
	});
});

describe('openEditorDiffNonBlocking', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(globalThis as {logger?: unknown}).logger = {
			info: vi.fn(),
			debug: vi.fn(),
			error: vi.fn(),
		};
	});

	it('spawns the --new-window diff command by default and reports success on exit 0', async () => {
		const child = new FakeChild();
		vi.mocked(spawn).mockReturnValue(child as never);

		const pending = openEditorDiffNonBlocking(
			'code',
			'/tmp/before',
			'/tmp/after',
		);
		expect(spawn).toHaveBeenCalledWith(
			'code --new-window --diff "/tmp/before" "/tmp/after"',
			expect.anything(),
		);

		child.emit('exit', 0);
		expect(isSuccess(await pending)).toBe(true);
	});

	it('spawns the --reuse-window diff command when told to reuse', async () => {
		const child = new FakeChild();
		vi.mocked(spawn).mockReturnValue(child as never);

		const pending = openEditorDiffNonBlocking(
			'code',
			'/tmp/before',
			'/tmp/after',
			'reuse',
		);
		expect(spawn).toHaveBeenCalledWith(
			'code --reuse-window --diff "/tmp/before" "/tmp/after"',
			expect.anything(),
		);

		child.emit('exit', 0);
		expect(isSuccess(await pending)).toBe(true);
	});

	it('reports a failure when the diff command exits non-zero', async () => {
		const child = new FakeChild();
		vi.mocked(spawn).mockReturnValue(child as never);

		const pending = openEditorDiffNonBlocking(
			'code',
			'/tmp/before',
			'/tmp/after',
		);
		child.emit('exit', 1);

		expect(isFail(await pending)).toBe(true);
	});
});
