import {spawn, spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {ulid} from 'ulid';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getSettingsState} from '../state/settings.state.js';
import {fileManager} from '../storage/file-manager.js';

// An editor command split into the binary and its arguments, ready to hand
// to spawn without a shell. Everything here exists to keep file paths in
// `args`, where they are opaque data, instead of inside a command string a
// shell would parse.
export type EditorInvocation = {command: string; args: string[]};

// Splits an editor command the way a shell would for the cases that actually
// occur — "code", "code --wait", "/Applications/My Editor/bin/code" — honouring
// quotes so a path with spaces survives as one token.
//
// Deliberately not a shell: no variable expansion, no command substitution, no
// operators, no globbing. That is the point. It handles the whitespace-and-
// quotes part of what `shell: true` used to do for us and nothing else, so
// there is no evaluation step left for a file name to reach.
export function tokenizeEditorCommand(editor: string): string[] {
	const tokens: string[] = [];
	let current = '';
	let started = false;
	let quote: '"' | "'" | null = null;

	for (const char of editor.trim()) {
		if (quote) {
			if (char === quote) quote = null;
			else current += char;
			continue;
		}

		if (char === '"' || char === "'") {
			quote = char;
			started = true;
			continue;
		}

		if (/\s/.test(char)) {
			if (started) tokens.push(current);
			current = '';
			started = false;
			continue;
		}

		current += char;
		started = true;
	}

	if (started) tokens.push(current);

	return tokens;
}

// Resolves the `$EDITOR` / `$VISUAL` placeholders that the settings allow-list
// accepts (see editor-config.ts). The shell used to expand these as a side
// effect of `shell: true`; spawning by argv means nothing expands them for us
// any more, so it happens here explicitly.
//
// Only ever applied to the configured setting, never to a value already read
// out of the environment — an EDITOR that literally contains "$EDITOR" would
// otherwise resolve against itself forever.
function resolveEditorPlaceholder(editor: string): string | undefined {
	const trimmed = editor.trim();
	if (trimmed === '$EDITOR') return process.env['EDITOR'];
	if (trimmed === '$VISUAL') return process.env['VISUAL'];
	return trimmed;
}

export function getEditorCandidates(): string[] {
	const {preferredEditor} = getSettingsState();

	const candidates = [
		preferredEditor ? resolveEditorPlaceholder(preferredEditor) : undefined,
		process.env['VISUAL'],
		process.env['EDITOR'],
	].filter((value): value is string => Boolean(value?.trim()));

	return [...new Set(candidates)];
}

// Matches on the binary alone, so an editor carrying flags ("code --wait") or
// given as a full path ("/usr/local/bin/code") still reads as VS Code.
export function isVSCodeEditor(editor: string): boolean {
	const [binary = ''] = tokenizeEditorCommand(editor);
	return /(^|\/)code(-insiders)?$/.test(binary);
}

// Builds `[binary, ...editorFlags, ...args]`. Any flags baked into the editor
// string keep their position ahead of the ones we add, which is where an
// editor expects its own options.
function buildInvocation(editor: string, args: string[]): EditorInvocation {
	const [command = '', ...editorArgs] = tokenizeEditorCommand(editor);
	return {command, args: [...editorArgs, ...args]};
}

export function buildEditorCommand(
	editor: string,
	filePath: string,
): EditorInvocation {
	return buildInvocation(
		editor,
		isVSCodeEditor(editor) ? ['--wait', filePath] : [filePath],
	);
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
): EditorInvocation {
	const windowFlag = windowMode === 'new' ? '--new-window' : '--reuse-window';
	return buildInvocation(editor, [windowFlag, '--diff', beforePath, afterPath]);
}

export function openEditorOnText(initial: string): Result<string> {
	const tmpDir = path.join(os.tmpdir(), 'epiq');
	fileManager.mkDir(tmpDir);

	const tmpPath = path.join(tmpDir, ulid());
	fileManager.writeToFile(tmpPath, initial ?? '');

	const editors = getEditorCandidates();

	for (const editor of editors) {
		const {command, args} = buildEditorCommand(editor, tmpPath);
		if (!command) continue;

		const result = spawnSync(command, args, {
			stdio: 'inherit',
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
	const [binary = ''] = tokenizeEditorCommand(editor);
	const name = binary.split('/').pop() ?? binary;
	return TERMINAL_ONLY_EDITOR_BINARIES.has(name);
}

// How long to watch a spawned editor command before assuming it launched
// successfully. A missing binary now surfaces as a spawn 'error' (ENOENT)
// rather than a shell exiting 127, but an editor that starts and then rejects
// its arguments still only shows up as a quick non-zero exit. Watching for that
// window is what turns those into real, reported failures instead of a false
// "success" the user has no way to notice.
const EDITOR_LAUNCH_GRACE_MS = 600;

function trySpawnCommand(
	{command, args}: EditorInvocation,
	label: string,
): Promise<Result<true>> {
	return new Promise(resolve => {
		if (!command) {
			resolve(failed(`"${label}" is not a usable editor command`));
			return;
		}

		// No `shell: true`: the paths travel as argv entries, so a file named
		// with shell syntax (`$(...)`, backticks, `;`) is passed through as the
		// literal name it is instead of being evaluated. See board: RKAZMMX.
		const child = spawn(command, args, {stdio: 'ignore', detached: true});
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
