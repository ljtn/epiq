import stringify from 'json-stringify-pretty-compact';
import path from 'node:path';
import {ulid} from 'ulid';
import {
	BoardContext,
	contextMap,
	SwimlaneContext,
	TicketContext,
	TicketFieldContext,
	WorkspaceContext,
} from '../model/context.model.js';
import {NavNode} from '../navigation/model/navigation-node.model.js';
import {fileManager} from './file-manager.js';

type DiskStorageDir =
	| 'workspaces'
	| 'boards'
	| 'swimlanes'
	| 'issues'
	| 'fields';

export type WorkspaceDiskNode = {
	id: string;
	title: string;
	value?: string;
	children: string[] | [];
};

export type WorkspaceDiskData = {
	// Pick up settings and other metadata in the future
	workspace: WorkspaceDiskNode;
};

export const storageManager = {
	rootPath: '',
	statePath: '',

	loadWorkspace() {
		const root = fileManager.locateFolder('.epiq');
		if (!root) {
			return logger.error('No project path found');
		}

		this.rootPath = root;
		this.statePath = path.join(this.rootPath, 'state');

		// State folder
		if (!fileManager.dirExists(this.statePath)) {
			fileManager.mkDir(this.statePath);
		}

		let workspaceJSON = fileManager.readFirstJSON<WorkspaceDiskNode>(
			path.join(this.statePath, 'workspaces'),
		);

		logger.debug(workspaceJSON);
		const ws = workspaceJSON || this.createWorkspace();
		if (!ws) {
			return logger.error('Could not initialize workspace');
		}
		return this.toWorkspace(ws);
	},

	createWorkspace() {
		try {
			logger.debug('hahah');
			const board = this.createNode({title: 'Board'}, 'boards');
			logger.debug(board);
			const workspace = this.createNode(
				{title: 'Workspace', children: [board.id]},
				'workspaces',
			);
			return workspace as WorkspaceDiskNode;
		} catch (e) {
			logger.error('Failed to create workspace file:', e);
			return;
		}
	},

	createValue(value: string) {
		const id = ulid();
		const folder = path.join(this.statePath, 'values', `${id}.txt`);
		fileManager.writeToFile(folder, value ?? '');
		return {value: value ?? '', id};
	},

	updateNode(node: WorkspaceDiskNode, nodeType: DiskStorageDir) {
		const folder = path.join(this.statePath, nodeType, `${node.id}.json`);

		const content = stringify(node, {maxLength: 1, indent: 2});
		fileManager.writeToFile(folder, content);
		return content;
	},

	createNode(
		{
			title,
			children,
		}: {title: string; children?: WorkspaceDiskNode['children']},
		nodeType: DiskStorageDir,
	) {
		const id = ulid();
		const folder = path.join(this.statePath, nodeType, `${id}.json`);
		const newNode = {
			title: this.createValue(title).id,
			children: children || [],
			id,
		};
		fileManager.writeToFile(
			folder,
			stringify(newNode, {maxLength: 1, indent: 2}),
		);
		return newNode;
	},

	createBoard(parentId: string, title: string): NavNode<BoardContext> {
		const newNode = this.createNode({title}, 'boards');
		const parent = this.getWorkspace(parentId);

		if (parent) {
			this.updateNode(
				{...parent, children: [...parent.children, newNode.id]},
				'workspaces',
			);
		}

		return this.toBoard(newNode);
	},

	createSwimlane(parentId: string, title: string): NavNode<'SWIMLANE'> {
		const newNode = this.createNode({title, children: []}, 'swimlanes');
		const parent = this.getBoard(parentId);
		if (parent) {
			this.updateNode(
				{...parent, children: [...parent.children, newNode.id]},
				'boards',
			);
		}
		return this.toSwimlane(newNode);
	},

	createIssue(parentId: string, title: string): NavNode<'TICKET'> {
		// Create fields
		const description = this.createField('Description', ['']);
		const tags = this.createField('Tags', ['demo']);

		// Create issue
		const newNode = this.createNode(
			{
				title: title,
				children: [description.id, tags.id],
			},
			'issues',
		);

		// Add to parent
		const parent = this.getSwimlane(parentId);
		if (parent) {
			this.updateNode(
				{...parent, children: [...parent.children, newNode.id]},
				'swimlanes',
			);
		}

		return this.toIssue(newNode);
	},

	createField(title: string, values: string[]): WorkspaceDiskNode {
		const valueIds = values.map(v => this.createValue(v).id);
		const field: WorkspaceDiskNode = {
			id: '',
			title: this.createValue(title).id, // <-- store id
			value: '',
			children: valueIds,
		};

		return this.createNode(field, 'fields');
	},

	getWorkspace(id: string): WorkspaceDiskNode | null {
		const folder = path.join(this.statePath, 'workspaces', `${id}.json`);
		return fileManager.readFileJSON(folder);
	},

	getBoard(id: string): WorkspaceDiskNode | null {
		const folder = path.join(this.statePath, 'boards', `${id}.json`);
		return fileManager.readFileJSON(folder);
	},

	getSwimlane(id: string): WorkspaceDiskNode | null {
		const folder = path.join(this.statePath, 'swimlanes', `${id}.json`);
		return fileManager.readFileJSON(folder);
	},

	getIssue(id: string): WorkspaceDiskNode | null {
		const folder = path.join(this.statePath, 'issues', `${id}.json`);
		return fileManager.readFileJSON(folder);
	},

	getField(id: string): WorkspaceDiskNode | null {
		const folder = path.join(this.statePath, 'fields', `${id}.json`);
		return fileManager.readFileJSON(folder);
	},

	getValue(id: string | undefined): string {
		if (!id) return '';
		const folder = path.join(this.statePath, 'values', `${id}.txt`);
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
			title: this.getValue(data.title),
			value: this.getValue(data.value),
			context: contextMap.WORKSPACE,
			isSelected: false,
			childRenderAxis: 'vertical',
			children: data.children.reduce((acc, childId) => {
				let item = this.getBoard(childId);
				if (item) acc.push(this.toBoard(item));
				return acc;
			}, [] as NavNode<BoardContext>[]),
		};
	},

	toBoard(data: WorkspaceDiskNode): NavNode<BoardContext> {
		return {
			id: data.id,
			title: this.getValue(data.title),
			value: this.getValue(data.value),
			context: contextMap.BOARD,
			isSelected: false,
			childRenderAxis: 'horizontal',
			children: data.children.reduce((acc, childId) => {
				let item = this.getSwimlane(childId);
				if (item) acc.push(this.toSwimlane(item));
				return acc;
			}, [] as NavNode<SwimlaneContext>[]),
		};
	},

	toSwimlane(data: WorkspaceDiskNode): NavNode<SwimlaneContext> {
		return {
			id: data.id,
			title: this.getValue(data.title),
			value: this.getValue(data.value),
			context: contextMap.SWIMLANE,
			isSelected: false,
			childRenderAxis: 'vertical',
			children: data.children.reduce((acc, childId) => {
				let item = this.getIssue(childId);
				if (item) acc.push(this.toIssue(item));
				return acc;
			}, [] as NavNode<TicketContext>[]),
		};
	},

	toIssue(data: WorkspaceDiskNode): NavNode<TicketContext> {
		return {
			id: data.id,
			title: this.getValue(data.title),
			value: this.getValue(data.value),
			context: contextMap.TICKET,
			isSelected: false,
			childRenderAxis: 'vertical',
			children: data.children.reduce((acc, childId) => {
				let item = this.getField(childId);
				if (item) acc.push(this.toField(item));
				return acc;
			}, [] as NavNode<TicketFieldContext>[]),
		};
	},

	toField(data: WorkspaceDiskNode): NavNode<TicketFieldContext> {
		return {
			id: data.id,
			title: this.getValue(data.title),
			value: this.getValues(data.children),
			context: contextMap.TICKET_FIELD,
			isSelected: false,
			childRenderAxis: 'vertical',
			children: [],
		};
	},
};
