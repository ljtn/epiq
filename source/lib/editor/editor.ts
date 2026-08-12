import {spawn, spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {ulid} from 'ulid';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getSettingsState} from '../state/settings.state.js';
import {fileManager} from '../storage/file-manager.js';

export function getEditorCandidates(): string[] {
	const {preferredEditor} = getSettingsState();

	const candidates = [
		preferredEditor,
		process.env['VISUAL'],
		process.env['EDITOR'],
	].filter((value): value is string => Boolean(value?.trim()));

	return [...new Set(candidates)];
}

export function isVSCodeEditor(editor: string): boolean {
	return /(^|\/)code(-insiders)?$/.test(editor.trim());
}

export function buildEditorCommand(editor: string, filePath: string): string {
	if (isVSCodeEditor(editor)) {
		return `${editor} --wait "${filePath}"`;
	}

	return `${editor} "${filePath}"`;
}

// VS Code's native two-pane diff view — unlike a plain .diff/.patch file
// (generic "diff" language mode, no per-language syntax highlighting), each
// side here is opened as its own real file, so VS Code applies the actual
// TSX/whatever grammar to it. No --wait: we just want the tab to open, not
// to block on the user closing it.
//
// `windowMode` controls which VS Code window the diff lands in: 'new' forces
// a fresh window (so inspecting a commit doesn't dump tabs into whatever the
// user already has open), 'reuse' forces it into the already-open window —
// used for every file after the first in a multi-file commit, so they all
// land together in that one new window instead of each spawning its own.
export function buildEditorDiffCommand(
	editor: string,
	beforePath: string,
	afterPath: string,
	windowMode: 'new' | 'reuse' = 'new',
): string {
	const windowFlag = windowMode === 'new' ? '--new-window' : '--reuse-window';
	return `${editor} ${windowFlag} --diff "${beforePath}" "${afterPath}"`;
}

export function openEditorOnText(initial: string): Result<string> {
	const tmpDir = path.join(os.tmpdir(), 'epiq');
	fileManager.mkDir(tmpDir);

	const tmpPath = path.join(tmpDir, ulid());
	fileManager.writeToFile(tmpPath, initial ?? '');

	const editors = getEditorCandidates();

	for (const editor of editors) {
		const cmd = buildEditorCommand(editor, tmpPath);

		const result = spawnSync(cmd, {
			stdio: 'inherit',
			shell: true,
		});

		if (!result.error && result.status === 0) {
			const updated = fileManager.readFile(tmpPath);
			if (updated == null) return failed('Unable to read edited file');

			const normalized = updated.replace(/\r?\n$/, '');
			return succeeded('Successfully edited', normalized);
		}
	}

	return failed('Unable to open editor');
}

// Editors that only work inside a real terminal (no GUI window of their
// own). The GUI server launches editors detached with stdio:'ignore' — there
// is no terminal for one of these to attach to, so spawning them "succeeds"
// (or just sits there) while the user sees nothing happen at all. Checked
// against just the binary name so a full path (e.g. "/usr/bin/vim") or
// trailing flags in `preferredEditor` still match.
const TERMINAL_ONLY_EDITOR_BINARIES = new Set([
	'vim',
	'vi',
	'nvim',
	'nano',
	'pico',
	'ed',
]);

function isTerminalOnlyEditor(editor: string): boolean {
	const binary = editor.trim().split(/\s+/)[0] ?? '';
	const name = binary.split('/').pop() ?? binary;
	return TERMINAL_ONLY_EDITOR_BINARIES.has(name);
}

// How long to watch a spawned editor command before assuming it launched
// successfully. `shell: true` means the shell itself always spawns fine even
// when the command inside it is broken (missing binary, an unset env-var
// placeholder like a literal "$EDITOR" expanding to nothing) — that failure
// only surfaces as a quick non-zero exit from the shell, not a spawn 'error'
// event. Watching for that window is what turns those into real, reported
// failures instead of a false "success" the user has no way to notice.
const EDITOR_LAUNCH_GRACE_MS = 600;

function trySpawnCommand(cmd: string, label: string): Promise<Result<true>> {
	return new Promise(resolve => {
		const child = spawn(cmd, {shell: true, stdio: 'ignore', detached: true});
		let settled = false;

		const settle = (result: Result<true>) => {
			if (settled) return;
			settled = true;
			clearTimeout(graceTimer);
			resolve(result);
		};

		child.on('error', error => settle(failed(error.message)));

		child.on('exit', code => {
			settle(
				code === 0
					? succeeded('Opened editor', true)
					: failed(`"${label}" exited with code ${code}`),
			);
		});

		const graceTimer = setTimeout(() => {
			// Still running past the grace window — a real, longer-lived
			// editor session rather than a broken command. `unref()` either
			// way so it can't keep the server process alive.
			child.unref();
			settle(succeeded('Opened editor', true));
		}, EDITOR_LAUNCH_GRACE_MS);
	});
}

function trySpawnEditor(
	editor: string,
	filePath: string,
): Promise<Result<true>> {
	if (isTerminalOnlyEditor(editor)) {
		return Promise.resolve(
			failed(
				`"${editor}" is a terminal editor and can't open from the GUI (no terminal attached). Set preferredEditor to a GUI editor (e.g. "code"), or open the file yourself: ${filePath}`,
			),
		);
	}

	return trySpawnCommand(buildEditorCommand(editor, filePath), editor);
}

// Opens VS Code's native two-pane diff view for a single before/after file
// pair. Only meaningful for VS Code (isVSCodeEditor) — callers are
// responsible for that check, since `--diff` isn't a general editor flag.
export function openEditorDiffNonBlocking(
	editor: string,
	beforePath: string,
	afterPath: string,
	windowMode: 'new' | 'reuse' = 'new',
): Promise<Result<true>> {
	return trySpawnCommand(
		buildEditorDiffCommand(editor, beforePath, afterPath, windowMode),
		editor,
	);
}

// Fire-and-forget variant for the GUI server: the server is one process
// serving every connected client, so blocking on `spawnSync`/stdio:'inherit'
// (as openEditorOnText does) would freeze every other client's browser
// session for as long as the user's editor stayed open. This awaits only a
// short, bounded window per candidate (see EDITOR_LAUNCH_GRACE_MS) — the
// server's event loop, and every other client's request, stays free the
// whole time; nothing here blocks the way a synchronous spawn would.
export async function openEditorOnFileNonBlocking(
	filePath: string,
): Promise<Result<true>> {
	const editors = getEditorCandidates();
	if (editors.length === 0) {
		return failed('No editor configured (preferredEditor, VISUAL, or EDITOR)');
	}

	let lastFailure: Result<true> = failed('Unable to open editor');

	for (const editor of editors) {
		const result = await trySpawnEditor(editor, filePath);
		if (!isFail(result)) return result;

		lastFailure = result;
		logger.error(
			`Failed to open editor "${editor}" for ${filePath}: ${result.message}`,
		);
	}

	return lastFailure;
}
