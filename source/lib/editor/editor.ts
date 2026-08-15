import {spawn, spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {ulid} from 'ulid';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {getSettingsState} from '../state/settings.state.js';
import {fileManager} from '../storage/file-manager.js';

// Editors are spawned by argv with no shell, so file paths stay opaque data.
export type EditorInvocation = {command: string; args: string[]};

// Splits on whitespace, honouring quotes so a path with spaces stays one token.
// This is not a shell and must not become one: no expansion, substitution,
// operators or globbing, so a file name has nothing left to be evaluated by.
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

// Spawning by argv means nothing expands these placeholders for us. Apply only
// to the configured setting: an env var containing "$EDITOR" would otherwise
// resolve against itself forever.
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

// Matches the binary alone, so flags or a full path still read as VS Code.
export function isVSCodeEditor(editor: string): boolean {
	const [binary = ''] = tokenizeEditorCommand(editor);
	return /(^|\/)code(-insiders)?$/.test(binary);
}

// Flags baked into the editor string stay ahead of the ones we add, where an
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

// VS Code's two-pane diff view. No --wait: we want the tab open, not to block
// on the user closing it. Callers pass 'reuse' for every file after the first
// so a multi-file diff lands in one window rather than spawning several.
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

// The GUI server spawns detached with stdio:'ignore', so these have no terminal
// to attach to and appear to succeed while the user sees nothing happen.
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

// Long enough to catch an editor that starts and then rejects its arguments,
// which surfaces only as a quick non-zero exit, short enough not to stall the
// caller waiting on a session that will outlive it.
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

		// Never `shell: true`: paths travel as argv, so a file name containing
		// shell syntax stays literal instead of being evaluated.
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
			// Still running, so treat it as a real session. `unref()` so it can't
			// keep the server process alive.
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

// `--diff` is not a general editor flag: callers must check isVSCodeEditor.
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

// For the GUI server, where one process serves every client: a synchronous
// spawn would freeze all of them for as long as the editor stayed open.
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
