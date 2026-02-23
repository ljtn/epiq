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

type NodeType = 'workspaces' | 'boards' | 'swimlanes' | 'issues' | 'fields';

export type WorkspaceDiskNode = {
	id: string;
	title: string; // value-id
	value?: string; // value-id
	children: string[] | [];
};

export type WorkspaceSnapshot = {
	id: string; // snapshot id (ulid)
	createdAt: string;
	rootWorkspaceId: string;
	nodes: {
		workspaces: Record<string, WorkspaceDiskNode>;
		boards: Record<string, WorkspaceDiskNode>;
		swimlanes: Record<string, WorkspaceDiskNode>;
		issues: Record<string, WorkspaceDiskNode>;
		fields: Record<string, WorkspaceDiskNode>;
	};
};

const SNAPSHOT_DIR = path.join('state', 'snapshots');
const VALUES_DIR = path.join('state', 'values');

export const storageManager = {
	rootPath: '',
	statePath: '',
	snapshot: null as WorkspaceSnapshot | null,

	loadWorkspace() {
		const root = fileManager.locateFolder('.epiq');
		if (!root) {
			logger.error('No project path found');
			return null;
		}

		this.rootPath = root;
		this.statePath = path.join(this.rootPath, 'state');

		fileManager.mkDir(path.join(this.rootPath, SNAPSHOT_DIR));
		fileManager.mkDir(path.join(this.rootPath, VALUES_DIR));

		const snap = this.readLatestSnapshot() ?? this.createInitialSnapshot();
		if (!snap) {
			logger.error('Could not initialize workspace snapshot');
			return null;
		}

		this.snapshot = snap;

		const ws = this.getNode('workspaces', snap.rootWorkspaceId);
		if (!ws) {
			logger.error('Workspace root missing from snapshot');
			return null;
		}

		return this.toWorkspace(ws);
	},

	snapshotFolder() {
		return path.join(this.rootPath, SNAPSHOT_DIR);
	},
	snapshotPath(id: string) {
		return path.join(this.rootPath, SNAPSHOT_DIR, `${id}.json`);
	},
	valuePath(id: string) {
		return path.join(this.rootPath, VALUES_DIR, `${id}.txt`);
	},

	readLatestSnapshot(): WorkspaceSnapshot | null {
		const folder = this.snapshotFolder();
		if (!fileManager.dirExists(folder)) return null;

		const entries = fileManager
			.listDir(folder)
			.filter((name: string) => name.endsWith('.json'))
			.sort();

		if (!entries.length) return null;

		const latestFile = entries.at(-1);
		if (!latestFile) return null;

		const latestPath = path.join(folder, latestFile);
		return fileManager.readFileJSON<WorkspaceSnapshot>(latestPath);
	},

	writeSnapshot(next: WorkspaceSnapshot): WorkspaceSnapshot {
		const id = ulid();
		const snap: WorkspaceSnapshot = {
			...next,
			id,
			createdAt: new Date().toISOString(),
		};

		fileManager.writeToFile(
			this.snapshotPath(id),
			stringify(snap, {maxLength: 1, indent: 2}),
		);
		this.snapshot = snap;
		return snap;
	},

	// ---------- initial state ----------
	createInitialSnapshot(): WorkspaceSnapshot | null {
		try {
			const draft = this.emptySnapshotDraft();

			const board = this.createNodeInMemory(draft, 'boards', {
				title: 'Board',
				children: [],
			});
			const workspace = this.createNodeInMemory(draft, 'workspaces', {
				title: 'Workspace',
				children: [board.id],
			});

			draft.rootWorkspaceId = workspace.id;

			return this.writeSnapshot(draft);
		} catch (e) {
			logger.error('Failed to create initial snapshot', e);
			return null;
		}
	},

	emptySnapshotDraft(): WorkspaceSnapshot {
		return {
			id: 'DRAFT',
			createdAt: 'DRAFT',
			rootWorkspaceId: 'DRAFT',
			nodes: {
				workspaces: {},
				boards: {},
				swimlanes: {},
				issues: {},
				fields: {},
			},
		};
	},

	// ---------- values ----------
	createValue(value: string) {
		const id = ulid();
		fileManager.writeToFile(this.valuePath(id), value ?? '');
		return {value: value ?? '', id};
	},

	getValue(id: string | undefined): string {
		if (!id) return '';
		const value = fileManager.readFile(this.valuePath(id)) ?? '';
		return value.replace(/\r?\n$/, '');
	},

	getValues(ids: string[] | []): string {
		if (!ids.length) return '';
		return ids.map(x => this.getValue(x)).join(', ');
	},

	// ---------- node access ----------
	requireSnapshot(): WorkspaceSnapshot {
		if (!this.snapshot) return logger.error('Snapshot not loaded');
		return this.snapshot;
	},

	getNode(type: NodeType, id: string): WorkspaceDiskNode | null {
		const snap = this.requireSnapshot();
		return snap.nodes[type][id] ?? null;
	},

	// ---------- in-memory node creation ----------
	createNodeInMemory(
		draft: WorkspaceSnapshot,
		nodeType: NodeType,
		{
			title,
			children,
		}: {title: string; children?: WorkspaceDiskNode['children']},
	): WorkspaceDiskNode {
		const id = ulid();
		const titleId = this.createValue(title).id;

		const node: WorkspaceDiskNode = {
			id,
			title: titleId,
			children: children ?? [],
		};

		draft.nodes[nodeType][id] = node;
		return node;
	},

	cloneForMutation(current: WorkspaceSnapshot): WorkspaceSnapshot {
		return {
			...current,
			nodes: {
				workspaces: {...current.nodes.workspaces},
				boards: {...current.nodes.boards},
				swimlanes: {...current.nodes.swimlanes},
				issues: {...current.nodes.issues},
				fields: {...current.nodes.fields},
			},
		};
	},

	// ---------- mutation helpers ----------
	mutate<T>(mutator: (draft: WorkspaceSnapshot) => T): {
		snap: WorkspaceSnapshot;
		result: T;
	} {
		const current = this.requireSnapshot();
		const draft = this.cloneForMutation(current);
		const result = mutator(draft);
		const snap = this.writeSnapshot(draft);
		return {snap, result};
	},

	// ---------- create operations ----------
	createBoard(parentWorkspaceId: string, title: string): NavNode<BoardContext> {
		const {snap, result: boardId} = this.mutate(draft => {
			const board = this.createNodeInMemory(draft, 'boards', {
				title,
				children: [],
			});

			const ws = draft.nodes.workspaces[parentWorkspaceId];
			if (!ws) throw new Error(`Workspace ${parentWorkspaceId} not found`);

			draft.nodes.workspaces[parentWorkspaceId] = {
				...ws,
				children: [...ws.children, board.id],
			};

			return board.id;
		});

		const board = snap.nodes.boards[boardId];
		if (!board) return logger.error('Unable to create board');
		return this.toBoard(board);
	},

	createSwimlane(
		parentBoardId: string,
		title: string,
	): NavNode<SwimlaneContext> {
		const {snap, result: laneId} = this.mutate(draft => {
			const lane = this.createNodeInMemory(draft, 'swimlanes', {
				title,
				children: [],
			});

			const board = draft.nodes.boards[parentBoardId];
			if (!board) throw new Error(`Board ${parentBoardId} not found`);

			draft.nodes.boards[parentBoardId] = {
				...board,
				children: [...board.children, lane.id],
			};

			return lane.id;
		});

		const swimlane = snap.nodes.swimlanes[laneId];
		if (!swimlane) return logger.error('Unable to create swimlane');
		return this.toSwimlane(swimlane);
	},

	createIssue(parentSwimlaneId: string, title: string): NavNode<TicketContext> {
		const {snap, result: issueId} = this.mutate(draft => {
			const descriptionField = this.createFieldInDraft(draft, 'Description', [
				'',
			]);
			const tagsField = this.createFieldInDraft(draft, 'Tags', ['demo']);

			const issue = this.createNodeInMemory(draft, 'issues', {
				title,
				children: [descriptionField.id, tagsField.id],
			});

			const lane = draft.nodes.swimlanes[parentSwimlaneId];
			if (!lane) throw new Error(`Swimlane ${parentSwimlaneId} not found`);

			draft.nodes.swimlanes[parentSwimlaneId] = {
				...lane,
				children: [...lane.children, issue.id],
			};

			return issue.id;
		});

		const issue = snap.nodes.issues[issueId];
		if (!issue) return logger.error('Unable to create issue');
		return this.toIssue(issue);
	},

	createFieldInDraft(
		draft: WorkspaceSnapshot,
		title: string,
		values: string[],
	): WorkspaceDiskNode {
		const valueIds = values.map(v => this.createValue(v).id);
		return this.createNodeInMemory(draft, 'fields', {
			title,
			children: valueIds,
		});
	},

	// ---------- mapping ----------
	toWorkspace(data: WorkspaceDiskNode): NavNode<WorkspaceContext> {
		return {
			id: data.id,
			title: this.getValue(data.title),
			value: this.getValue(data.value),
			context: contextMap.WORKSPACE,
			isSelected: false,
			childRenderAxis: 'vertical',
			children: data.children.reduce((acc, childId) => {
				const item = this.getNode('boards', childId);
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
				const item = this.getNode('swimlanes', childId);
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
				const item = this.getNode('issues', childId);
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
				const item = this.getNode('fields', childId);
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
