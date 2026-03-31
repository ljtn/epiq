import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {ulid} from 'ulid';
import {failed, Result, succeeded} from '../lib/command-line/command-types.js';
import {fileManager} from '../lib/storage/file-manager.js';

function pickEditor(): string {
	return process.env['VISUAL'] || process.env['EDITOR'] || 'vi';
}
export function openEditorOnText(initial: string): Result<string> {
	const editor = pickEditor();

	const tmpDir = path.join(os.tmpdir(), 'epiq');
	fileManager.mkDir(tmpDir);

	const tmpPath = path.join(tmpDir, ulid());
	fileManager.writeToFile(tmpPath, initial ?? '');

	const isVSCode = /(^|\/)code(-insiders)?$/.test(editor);
	const cmd = isVSCode
		? `${editor} --wait "${tmpPath}"`
		: `${editor} "${tmpPath}"`;

	const result = spawnSync(cmd, {
		stdio: 'inherit',
		shell: true,
	});

	if (result.error) {
		console.error('Editor failed:', result.error);
		return failed('Editor failed');
	}

	const updated = fileManager.readFile(tmpPath);
	if (updated == null) return failed('Unable to read edited file');

	// Remove trailing new line
	const normalized = updated.replace(/\r?\n$/, '');

	return succeeded('Successfully edited', normalized);
}
