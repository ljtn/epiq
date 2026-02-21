import path from 'node:path';
import {
	BoardContext,
	contextMap,
	SwimlaneContext,
	TicketContext,
	TicketFieldContext,
	Workspace,
	WorkspaceContext,
} from '../model/context.model.js';
import {NavNode} from '../navigation/model/navigation-node.model.js';
import {fileManager} from './file-manager.js';

export type WorkspaceDiskNode = {
	id: string;
	name: string;
	value?: string;
	children: string[] | [];
};

export type WorkspaceDiskData = {
	// Pick up settings and other metadata in the future
	workspace: WorkspaceDiskNode;
};

export const storageManager = {
	rootPath: '',
	loadWorkspace(): Workspace | null {
		let workspaceFolder = fileManager.locateFolder('.epiq');
		if (!workspaceFolder) {
			// TODO: Move to wizard flow to create workspace if not found
			this.rootPath = path.join(process.cwd(), '.epiq');
			this.createWorkspace(this.rootPath);
		}

		const workspaceDiskData = this.getWorkspace();
		// const workspace: Workspace = this.getWorkspace(workspaceDiskData);
		if (!workspaceDiskData) return null;
		try {
			// return workspaceDiskData.workspace;
			return {} as Workspace;
		} catch (e) {
			logger.error('Failed to parse workspace data:', e);
			return null;
		}
	},

	createWorkspace(targetPath: string) {
		const templatePath = path.join(
			process.cwd(),
			'source',
			'lib',
			'storage',
			'default-workspace.json',
		);
		const defaultWorkspace = fileManager.readFileJSON(templatePath);
		if (!defaultWorkspace) {
			logger.error('Failed to read default workspace template.');
			return;
		}

		try {
			return fileManager.createFile(
				path.join(targetPath, 'workspace.json'),
				defaultWorkspace,
			);
		} catch (e) {
			logger.error('Failed to create workspace file:', e);
			return;
		}
	},

	getWorkspace(): Workspace | undefined {
		const workspaceFilePath = path.join('.epiq', 'workspace.json');
		const projPath = fileManager.locateFolder(workspaceFilePath);
		if (!projPath) {
			throw new Error('No project path found');
			return;
		}
		this.rootPath = path.join(projPath, '.epiq') || '';
		const workspaceDiskData = fileManager.readFileJSON(workspaceFilePath);
		const workspace = this.toWorkspace(workspaceDiskData);
		return workspace;
	},

	getBoard(id: string): WorkspaceDiskNode | null {
		const folder = path.join(this.rootPath, 'boards', `${id}.json`);
		return fileManager.readFileJSON(folder);
	},

	getSwimlane(id: string): WorkspaceDiskNode | null {
		const folder = path.join(this.rootPath, 'swimlanes', `${id}.json`);
		return fileManager.readFileJSON(folder);
	},

	getIssue(id: string): WorkspaceDiskNode | null {
		const folder = path.join(this.rootPath, 'issues', `${id}.json`);
		return fileManager.readFileJSON(folder);
	},

	getField(id: string): WorkspaceDiskNode | null {
		const folder = path.join(this.rootPath, 'fields', `${id}.json`);
		return fileManager.readFileJSON(folder);
	},

	getValue(id: string | undefined): string {
		if (!id) return '';
		const folder = path.join(this.rootPath, 'values', `${id}.txt`);
		const value = fileManager.readFile(folder) ?? '';
		const withoutTrailingLineBreak = value.replace(/\r?\n$/, '');
		return withoutTrailingLineBreak;
	},

	getValues(ids: string[] | []): string {
		if (!ids.length) return '';
		return ids ? ids.map(x => this.getValue(x)).join(', ') : '';
	},

	toWorkspace(data: WorkspaceDiskNode): NavNode<WorkspaceContext> {
		return {
			id: 'WORKSPACE_ID',
			name: this.getValue(data.name),
			value: this.getValue(data.value),
			context: contextMap.WORKSPACE,
			isSelected: false,
			childrenRenderAxis: 'vertical',
			children: data.children.reduce((acc, childId) => {
				let item = this.getBoard(childId);
				if (item) acc.push(this.toBoard(item, childId));
				return acc;
			}, [] as NavNode<BoardContext>[]),
		};
	},

	toBoard(data: WorkspaceDiskNode, id: string): NavNode<BoardContext> {
		return {
			id,
			name: this.getValue(data.name),
			value: this.getValue(data.value),
			context: contextMap.BOARD,
			isSelected: false,
			childrenRenderAxis: 'horizontal',
			children: data.children.reduce((acc, childId) => {
				let item = this.getSwimlane(childId);
				if (item) acc.push(this.toSwimlane(item, childId));
				return acc;
			}, [] as NavNode<SwimlaneContext>[]),
		};
	},

	toSwimlane(data: WorkspaceDiskNode, id: string): NavNode<SwimlaneContext> {
		return {
			id,
			name: this.getValue(data.name),
			value: this.getValue(data.value),
			context: contextMap.SWIMLANE,
			isSelected: false,
			childrenRenderAxis: 'vertical',
			children: data.children.reduce((acc, childId) => {
				let item = this.getIssue(childId);
				if (item) acc.push(this.toIssue(item, childId));
				return acc;
			}, [] as NavNode<TicketContext>[]),
		};
	},

	toIssue(data: WorkspaceDiskNode, id: string): NavNode<TicketContext> {
		return {
			id,
			name: this.getValue(data.name),
			value: this.getValue(data.value),
			context: contextMap.TICKET,
			isSelected: false,
			childrenRenderAxis: 'vertical',
			children: data.children.reduce((acc, childId) => {
				let item = this.getField(childId);
				if (item) acc.push(this.toField(item, childId));
				return acc;
			}, [] as NavNode<TicketFieldContext>[]),
		};
	},

	toField(data: WorkspaceDiskNode, id: string): NavNode<TicketFieldContext> {
		return {
			id,
			name: this.getValue(data.name),
			value: this.getValues(data.children),
			context: contextMap.TICKET_FIELD,
			isSelected: false,
			childrenRenderAxis: 'vertical',
			children: [],
		};
	},
};
