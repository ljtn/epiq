import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {Workspace} from '../model/context.model.js';
import {ticketFromData} from '../navigation/actions/add-item/add-item-actions.js';

export type DiscWorkspace = {
	id: string;
	name: string;
	children: string[];
};

export type DiscBoard = {
	name: string;
	children: string[];
};

export type DiscSwimlane = {
	name: string;
	children: string[];
};

export type DiscTicket = {
	name: string;
	children: string[]; // List of issue IDs
};

export type DiscField = {
	name: string;
	children: string[]; //
};

export type WorkspaceDiskData = {
	// Pick up settings and other metadata in the future
	workspace: DiscWorkspace;
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

	getField(fieldId: string) {
		const filePath = path.join(
			this.locateWorkspaceFolder()!,
			'fields',
			fieldId + '.json',
		);
		const field = this.readJsonFile(filePath);
		if (!field) {
			console.warn(`Field file not found for ID ${fieldId}: ${filePath}`);
			return null;
		}
		return field;
	},

	getIssue(issueId: string) {
		const filePath = path.join(
			this.locateWorkspaceFolder()!,
			'issues',
			issueId + '.json',
		);
		return this.readJsonFile(filePath);
	},

	readJsonFile: (filePath: string): any | null => {
		try {
			return JSON.parse(readFileSync(filePath, 'utf-8'));
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
			this.readJsonFile(workspaceFile) ?? '{}',
		);

		const issuesIds = workspace.children.map(board =>
			board.children.map(lane =>
				lane.children.map(ticket => ticketFromData(ticket)),
			),
		);

		issuesIds.map(issueId => {
			const issueFile = path.join(workspaceFolder, 'issues', issueId + '.json');
			if (!existsSync(issueFile)) {
				console.warn(`Issue file not found for ID ${issueId}: ${issueFile}`);
				return;
			}
			const issueData = JSON.parse(this.readJsonFile(issueFile) ?? '{}');
			return {issueId, issueData};
		});

		return {workspace};
	},
};
