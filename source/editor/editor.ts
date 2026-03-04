import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {NavNode} from '../lib/model/navigation-node.model.js';
import {fileManager} from '../lib/storage/file-manager.js';
import {storageManager} from '../lib/storage/storage-manager.js';

function pickEditor(): string {
	return process.env['VISUAL'] || process.env['EDITOR'] || 'vi';
}
function openEditorOnText(initial: string, fileLabel: string): string | null {
	const editor = pickEditor();

	const tmpDir = path.join(os.tmpdir(), 'epiq');
	fileManager.mkDir(tmpDir);

	const tmpPath = path.join(tmpDir, fileLabel);
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
		return null;
	}

	const updated = fileManager.readFile(tmpPath);
	if (updated == null) return null;

	// Remove trailing new line
	const normalized = updated.replace(/\r?\n$/, '');

	return normalized;
}

export function editSelectedTicketFieldValue(field: NavNode<'FIELD'>): {
	isUpdated: boolean;
	resourceId: string;
	value: string | null;
} | null {
	if (field.context !== 'FIELD') {
		logger.error('Node is not of type field');
		return null;
	}

	const fieldDisk = storageManager.getNode('fields', field.id);
	if (!fieldDisk) {
		logger.error('Unable to locate field on disk');
		return null;
	}

	const valueResId = fieldDisk.props?.['value'];
	if (!valueResId) {
		logger.error(`Field ${fieldDisk.id} is missing props.value`);
		return null;
	}

	const before = storageManager.getResource(valueResId);
	if (!before) {
		return null;
	}
	const value = openEditorOnText(before, `${fieldDisk.id}.value.md`);
	return {isUpdated: value !== before, resourceId: valueResId, value};
}
