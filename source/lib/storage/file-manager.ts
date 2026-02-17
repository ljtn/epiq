import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {Workspace} from '../model/context.model.js';

export type WorkspaceDiskData = {
	// Pick up settings and other metadata in the future
	workspace: Workspace;
};

export const fileManager = {
	createFile: (filePath: string, content: string) => {
		try {
			const dir = path.dirname(filePath);
			if (!existsSync(dir)) {
				mkdirSync(dir, {recursive: true});
			}
			writeFileSync(filePath, content, 'utf-8');
		} catch (e) {
			console.error(`Failed to create file at ${filePath}:`, e);
		}
	},

	getIssue(issueId: string): string {
		const filePath = path.join(
			this.locateWorkspaceFolder()!,
			'issues',
			issueId + '.txt',
		);
		try {
			return readFileSync(filePath, 'utf-8');
		} catch (e) {
			console.error(`Failed to read file at ${filePath}:`, e);
			return '';
		}
	},

	readFile: (filePath: string): string | null => {
		try {
			return readFileSync(filePath, 'utf-8');
		} catch (e) {
			console.error(`Failed to read file at ${filePath}:`, e);
			return null;
		}
	},

	locateWorkspaceFolder: (): string | null => {
		let currentPath = process.cwd();
		const {root} = path.parse(currentPath);

		while (true) {
			const epiqPath = path.join(currentPath, '.epiq');
			const workspaceFile = path.join(epiqPath, 'workspace.json');

			if (existsSync(workspaceFile)) {
				return epiqPath;
			}

			if (currentPath === root) {
				break;
			}
			currentPath = path.dirname(currentPath);
		}

		return null;
	},

	getWorkspaceData(workspaceFolder: string): WorkspaceDiskData | null {
		const workspaceFile = path.join(workspaceFolder, 'workspace.json');

		// Todo add schema validation for workspace data
		const workspace: Workspace = JSON.parse(
			this.readFile(workspaceFile) ?? '{}',
		);
		return {workspace};
	},
};
