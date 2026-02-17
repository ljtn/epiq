import path from 'node:path';
import {fileManager} from './file-manager.js';
import {Workspace} from '../model/context.model.js';

export const loadWorkspace = (): Workspace | null => {
	let workspaceFolder = fileManager.locateWorkspaceFolder();
	if (!workspaceFolder) {
		// TODO: Move to wizard flow to create workspace if not found
		workspaceFolder = path.join(process.cwd(), '.epiq');
		createWorkspace(workspaceFolder);
	}

	const workspaceData = fileManager.getWorkspaceData(workspaceFolder);
	if (!workspaceData) return null;
	try {
		return workspaceData.workspace;
	} catch (e) {
		console.error('Failed to parse workspace data:', e);
		return null;
	}
};

const createWorkspace = (targetPath: string) => {
	const templatePath = path.join(
		process.cwd(),
		'source',
		'lib',
		'storage',
		'default-workspace.json',
	);
	const defaultWorkspace = fileManager.readFile(templatePath);
	if (!defaultWorkspace) {
		console.error('Failed to read default workspace template.');
		return;
	}

	try {
		return fileManager.createFile(
			path.join(targetPath, 'workspace.json'),
			defaultWorkspace,
		);
	} catch (e) {
		console.error('Failed to create workspace file:', e);
		return;
	}
};
