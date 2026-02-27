import stringify from 'json-stringify-pretty-compact';
import path from 'node:path';
import {ulid} from 'ulid';
import {fileManager} from './file-manager.js';

export type NodeType =
	| 'workspaces'
	| 'boards'
	| 'swimlanes'
	| 'issues'
	| 'fields';

export type WorkspaceDiskNode = {
	id: string;
	title: string; // resource id (versioned)
	value?: string; // resource id (versioned)
	children: string[] | [];
};

export type WorkspaceSnapshot = {
	id: string; // version id (ulid)
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

const STATE_DIR = path.join('snapshots', 'state');
const RESOURCES_DIR = path.join('snapshots', 'resources');

// logical state “resource” id (single stream of versions)
const WORKSPACE_STATE_ID = 'workspace';

export const storageManager = {
	rootPath: '',
	snapshot: null as WorkspaceSnapshot | null,

	loadWorkspace() {
		const root = fileManager.locateFolder('.epiq');
		if (!root) {
			logger.error('No project path found');
			return null;
		}

		this.rootPath = root;

		// base dirs
		fileManager.mkDir(path.join(this.rootPath, STATE_DIR));
		fileManager.mkDir(path.join(this.rootPath, RESOURCES_DIR));

		// ensure logical state folder exists
		fileManager.mkDir(this.stateFolder(WORKSPACE_STATE_ID));

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

		return ws;
	},

	// -------------------------
	// Versioned state snapshots
	// -------------------------

	stateFolder(stateId: string) {
		return path.join(this.rootPath, STATE_DIR, stateId);
	},

	stateVersionPath(stateId: string, versionId: string) {
		return path.join(this.stateFolder(stateId), `${versionId}.json`);
	},

	listStateVersions(stateId: string): string[] {
		const folder = this.stateFolder(stateId);
		if (!fileManager.dirExists(folder)) return [];

		return fileManager
			.listDir(folder)
			.filter((name: string) => name.endsWith('.json'))
			.sort(); // ulid sort === time sort
	},

	// indexFromLatest: 0 = latest, 1 = previous, ...
	readSnapshot(
		stateId = WORKSPACE_STATE_ID,
		indexFromLatest = 0,
	): WorkspaceSnapshot | null {
		const versions = this.listStateVersions(stateId);
		if (!versions.length) return null;

		const pickIdx = versions.length - 1 - Math.max(0, indexFromLatest);
		const file = versions[pickIdx];
		if (!file) return null;

		return fileManager.readFileJSON<WorkspaceSnapshot>(
			path.join(this.stateFolder(stateId), file),
		);
	},

	readLatestSnapshot(): WorkspaceSnapshot | null {
		return this.readSnapshot(WORKSPACE_STATE_ID, 0);
	},

	writeSnapshot(
		next: WorkspaceSnapshot,
		stateId = WORKSPACE_STATE_ID,
	): WorkspaceSnapshot {
		const versionId = ulid();

		const snap: WorkspaceSnapshot = {
			...next,
			id: versionId,
			createdAt: new Date().toISOString(),
		};

		// ensure folder exists
		fileManager.mkDir(this.stateFolder(stateId));

		fileManager.writeToFile(
			this.stateVersionPath(stateId, versionId),
			stringify(snap, {maxLength: 1, indent: 2}),
		);

		this.snapshot = snap;
		return snap;
	},

	// -------------------------
	// Versioned resources
	// -------------------------

	resourceFolder(resourceId: string) {
		return path.join(this.rootPath, RESOURCES_DIR, resourceId);
	},

	resourceVersionPath(resourceId: string, versionId: string) {
		return path.join(this.resourceFolder(resourceId), `${versionId}.txt`);
	},

	listResourceVersions(resourceId: string): string[] {
		const folder = this.resourceFolder(resourceId);
		if (!fileManager.dirExists(folder)) return [];

		return fileManager
			.listDir(folder)
			.filter((name: string) => name.endsWith('.txt'))
			.sort();
	},

	// indexFromLatest: 0 = latest, 1 = previous, ...
	resolveResourceVersion(
		resourceId: string,
		indexFromLatest = 0,
	): string | null {
		const versions = this.listResourceVersions(resourceId);
		if (!versions.length) return null;

		const pickIdx = versions.length - 1 - Math.max(0, indexFromLatest);
		const file = versions[pickIdx];
		return file ? file.replace(/\.txt$/, '') : null;
	},

	/**
	 * Create a new logical resource (new folder) with initial version.
	 * Returns the resource id (stable), not the version id.
	 */
	createResource(value: string) {
		const resourceId = ulid();
		fileManager.mkDir(this.resourceFolder(resourceId));

		const versionId = ulid();
		fileManager.writeToFile(
			this.resourceVersionPath(resourceId, versionId),
			value ?? '',
		);

		return {value: value ?? '', id: resourceId, versionId};
	},

	/**
	 * Append a new version to an existing resource id.
	 * If resource doesn't exist, creates it (handy for migrations).
	 */
	updateResource(resourceId: string, nextValue: string) {
		fileManager.mkDir(this.resourceFolder(resourceId));

		const versionId = ulid();
		fileManager.writeToFile(
			this.resourceVersionPath(resourceId, versionId),
			nextValue ?? '',
		);

		return {value: nextValue ?? '', id: resourceId, versionId};
	},

	/**
	 * Default latest. Pass indexFromLatest to read older versions.
	 * indexFromLatest = 0 => latest
	 * indexFromLatest = 1 => previous
	 */
	getResource(resourceId: string | undefined, indexFromLatest = 0): string {
		if (!resourceId) return '';

		const versionId = this.resolveResourceVersion(resourceId, indexFromLatest);
		if (!versionId) return '';

		const raw =
			fileManager.readFile(this.resourceVersionPath(resourceId, versionId)) ??
			'';
		return raw.replace(/\r?\n$/, '');
	},

	getResources(resourceIds: string[] | [], indexFromLatest = 0): string {
		if (!resourceIds.length) return '';
		return resourceIds
			.map(id => this.getResource(id, indexFromLatest))
			.join(', ');
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

		// title is a versioned resource id
		const titleResourceId = this.createResource(title).id;

		const node: WorkspaceDiskNode = {
			id,
			title: titleResourceId,
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
	createBoard(parentWorkspaceId: string, title: string): WorkspaceDiskNode {
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
		return board;
	},

	createSwimlane(parentBoardId: string, title: string): WorkspaceDiskNode {
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
		return swimlane;
	},

	createIssue(parentSwimlaneId: string, title: string): WorkspaceDiskNode {
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
		return issue;
	},

	createFieldInDraft(
		draft: WorkspaceSnapshot,
		title: string,
		values: string[],
	): WorkspaceDiskNode {
		const resourceIds = values.map(v => this.createResource(v).id);
		return this.createNodeInMemory(draft, 'fields', {
			title,
			children: resourceIds,
		});
	},
	// ---------- move ----------
	move({
		parentType,
		fromParentId,
		fromIndex,
		toParentId,
		toIndex,
	}: {
		parentType: NodeType;
		fromParentId: string;
		fromIndex: number;
		toParentId: string;
		toIndex: number;
	}): {snap: WorkspaceSnapshot; nodeId: string} | null {
		const result = this.mutate(draft => {
			const fromParent = draft.nodes[parentType][fromParentId];
			const toParent = draft.nodes[parentType][toParentId];

			if (!fromParent) {
				return logger.error(
					`fromParent ${fromParentId} not found in ${parentType}`,
				);
			}

			if (!toParent) {
				return logger.error(
					`toParent ${toParentId} not found in ${parentType}`,
				);
			}

			if (fromIndex < 0 || fromIndex >= fromParent.children.length) {
				return logger.error(`fromIndex ${fromIndex} out of bounds`);
			}

			const fromChildren = [...fromParent.children];

			const [movedId] = fromChildren.splice(fromIndex, 1);

			draft.nodes[parentType][fromParentId] = {
				...fromParent,
				children: fromChildren,
			};

			const baseChildren =
				fromParentId === toParentId ? fromChildren : [...toParent.children];

			const clampedIndex = Math.max(0, Math.min(toIndex, baseChildren.length));

			if (movedId) {
				baseChildren.splice(clampedIndex, 0, movedId);
			}

			draft.nodes[parentType][toParentId] = {
				...toParent,
				children: baseChildren,
			};

			return movedId;
		});

		if (!result || !result.result) return null;

		return {
			snap: result.snap,
			nodeId: result.result,
		};
	},

	// -------------------------
	// Convenience “require” APIs
	// -------------------------

	/**
	 * Require state snapshot version; defaults to latest.
	 * indexFromLatest=1 gets previous snapshot, etc.
	 */
	requireState(indexFromLatest = 0): WorkspaceSnapshot {
		const snap = this.readSnapshot(WORKSPACE_STATE_ID, indexFromLatest);
		if (!snap) return logger.error('No snapshot found');
		return snap;
	},

	/**
	 * Require resource; defaults to latest.
	 * indexFromLatest=1 gets previous version, etc.
	 */
	requireResource(resourceId: string, indexFromLatest = 0): string {
		return this.getResource(resourceId, indexFromLatest);
	},
};
