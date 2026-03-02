import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {appState} from '../lib/state/state.js';
import {fileManager} from '../lib/storage/file-manager.js';
import {storageManager} from '../lib/storage/storage-manager.js';
import {nodeMapper} from '../lib/utils/node-mapper.js';

function pickEditor(): string {
	return process.env['VISUAL'] || process.env['EDITOR'] || 'vim';
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
	return updated ?? null;
}

export function editSelectedTicketFieldValue(): void {
	const ticket = appState.currentNode;
	if (ticket.context !== 'TICKET') return;

	const selectedFieldNav = ticket.children[appState.selectedIndex];
	if (!selectedFieldNav) return;

	const nodeType = nodeMapper.contextToNodeTypeMap(selectedFieldNav.context);
	if (nodeType !== 'fields') return;

	const fieldDisk = storageManager.getNode('fields', selectedFieldNav.id);
	if (!fieldDisk) return;

	const valueResId = fieldDisk.props?.['value'];
	if (!valueResId) {
		logger.error(`Field ${fieldDisk.id} is missing props.value`);
		return;
	}

	const before = storageManager.getResource(valueResId);

	const edited = openEditorOnText(before, `${fieldDisk.id}.value.md`);
	if (edited === null) return;

	if (edited !== before) {
		storageManager.updateResource(valueResId, edited);
	}
}
