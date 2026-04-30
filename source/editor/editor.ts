import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {ulid} from 'ulid';
import {failed, Result, succeeded} from '../lib/command-line/command-types.js';
import {getSettingsState} from '../lib/state/settings.state.js';
import {fileManager} from '../lib/storage/file-manager.js';

function getEditorCandidates(): string[] {
	const {preferredEditor} = getSettingsState();

	const candidates = [
		preferredEditor,
		process.env['VISUAL'],
		process.env['EDITOR'],
		'vim',
		'nano',
	].filter((value): value is string => Boolean(value?.trim()));

	return [...new Set(candidates)];
}

function buildEditorCommand(editor: string, filePath: string): string {
	const isVSCode = /(^|\/)code(-insiders)?$/.test(editor.trim());

	if (isVSCode) {
		return `${editor} --wait "${filePath}"`;
	}

	return `${editor} "${filePath}"`;
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
