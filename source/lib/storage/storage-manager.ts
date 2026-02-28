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
	fields: Record<string, string>;
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

// logical state “resource” id (single stream of versions)
const WORKSPACE_STATE_ID = 'workspace';

const SEED_RESOURCES = {
	name: 'seed:fieldName:name',
	tags: 'seed:fieldName:tags',
	assignees: 'seed:fieldName:assignees',
} as const;

export const storageManager = {
	ROOT_DIR: '',
	RESOURCES_DIR: '',
	STATE_DIR: '',
	snapshot: null as WorkspaceSnapshot | null,

	loadWorkspace() {
		const root = fileManager.locateFolder('.epiq');
		if (!root) {
			logger.error('No project path found');
			return null;
		}

		this.ROOT_DIR = root;
		this.RESOURCES_DIR = path.join(this.ROOT_DIR, 'snapshots', 'resources');
		this.STATE_DIR = path.join(this.ROOT_DIR, 'snapshots', 'state');

		// base dirs
		fileManager.mkDir(this.STATE_DIR);
		fileManager.mkDir(this.RESOURCES_DIR);

		// ensure logical state folder exists
		fileManager.mkDir(this.stateFolder(WORKSPACE_STATE_ID));

		// Create seeded field
		this.ensureSeeds();

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

	ensureSeedResource(resourceId: string, initialValue: string) {
		// If folder exists, assume it has at least one version.
		if (fileManager.dirExists(this.resourceFolder(resourceId))) return;

		fileManager.mkDir(this.resourceFolder(resourceId));
		const versionId = ulid();
		fileManager.writeToFile(
			this.resourceVersionPath(resourceId, versionId),
			initialValue,
		);
	},

	ensureSeeds() {
		this.ensureSeedResource(SEED_RESOURCES.name, 'Description');
		this.ensureSeedResource(SEED_RESOURCES.tags, 'Tags');
	},

	// -------------------------
	// Versioned state snapshots
	// -------------------------

	stateFolder(stateId: string) {
		return path.join(this.STATE_DIR, stateId);
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
		return path.join(this.RESOURCES_DIR, resourceId);
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

	updateResource(resourceId: string, nextValue: string) {
		fileManager.mkDir(this.resourceFolder(resourceId));

		const versionId = ulid();
		fileManager.writeToFile(
			this.resourceVersionPath(resourceId, versionId),
			nextValue ?? '',
		);

		return {value: nextValue ?? '', id: resourceId, versionId};
	},

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
			fields,
		}: {
			title: string;
			children?: WorkspaceDiskNode['children'];
			fields?: Record<string, string>;
		},
		titleResourceId?: string,
	): WorkspaceDiskNode {
		const id = ulid();
		const effectiveTitleId = titleResourceId ?? this.createResource(title).id;

		const node: WorkspaceDiskNode = {
			id,
			fields: {
				title: effectiveTitleId,
				...(fields ?? {}),
			},
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
		const DESCRIPTION_PLACEHOLDER = `...`;

		const {snap, result: issueId} = this.mutate(draft => {
			const descriptionField = this.createFieldInDraft(draft, {
				labelResourceId: SEED_RESOURCES.name,
				initialValue: DESCRIPTION_PLACEHOLDER,
			});

			const tagsField = this.createFieldInDraft(draft, {
				labelResourceId: SEED_RESOURCES.tags,
				initialValue: 'demo',
			});

			const assigneesField = this.createFieldInDraft(draft, {
				labelResourceId: SEED_RESOURCES.assignees,
				initialValue: '',
			});

			const issue = this.createNodeInMemory(draft, 'issues', {
				title,
				children: [assigneesField.id, descriptionField.id, tagsField.id],
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

	// createUser(title: string): WorkspaceDiskNode {
	// 	const NAME_PLACEHOLDER = `createRandom8CharName()`;

	// 	const {snap, result: userId} = this.mutate(draft => {
	// 		const nameField = this.createFieldInDraft(draft, {
	// 			labelResourceId: SEED_RESOURCES.name,
	// 			initialValue: NAME_PLACEHOLDER,
	// 		});

	// 		const user = this.createNodeInMemory(draft, 'issues', {
	// 			title,
	// 			children: [nameField.id],
	// 		});

	// 		draft.nodes.settings.users[user.id] = {
	// 			...user,
	// 		};

	// 		return user.id;
	// 	});

	// 	const userRef = snap.nodes.settings[userId];
	// 	if (!userRef) return logger.error('Unable to create issue');
	// 	return userRef;
	// },

	/**
	 * Field nodes:
	 * - fields.title is the label (seeded resource id)
	 * - fields.value is the value (resource id)
	 * - children is for nested nodes
	 */
	createFieldInDraft(
		draft: WorkspaceSnapshot,
		{
			labelResourceId,
			initialValue,
		}: {labelResourceId: string; initialValue: string},
	): WorkspaceDiskNode {
		const valueResourceId = this.createResource(initialValue).id;

		return this.createNodeInMemory(
			draft,
			'fields',
			{
				title: 'PLACEHOLDER', // ignored because we pass titleResourceId
				children: [],
				fields: {
					value: valueResourceId,
				},
			},
			labelResourceId,
		);
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
			if (movedId) baseChildren.splice(clampedIndex, 0, movedId);

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

	isSeedResource(resourceId: string) {
		return resourceId.startsWith('seed:');
	},

	renameNodeTitle(nodeType: NodeType, nodeId: string, nextTitle: string) {
		const res = this.mutate(draft => {
			const node = draft.nodes[nodeType][nodeId];
			if (!node) return logger.error(`Node ${nodeId} not found in ${nodeType}`);

			const currentTitleResId = node.fields['title'];
			if (!currentTitleResId)
				return logger.error(`Node ${nodeId} missing fields.title`);

			// Fork if seeded, so renaming doesn’t rename the shared seed
			if (this.isSeedResource(currentTitleResId)) {
				const newTitleResId = this.createResource(nextTitle).id;
				draft.nodes[nodeType][nodeId] = {
					...node,
					fields: {
						...node.fields,
						title: newTitleResId,
					},
				};
				return nodeId;
			}

			// Normal case: append a new version to the existing title resource
			this.updateResource(currentTitleResId, nextTitle);
			return nodeId;
		});

		return res?.result ? {snap: res.snap, nodeId: res.result} : null;
	},

	// -------------------------
	// Convenience “require” APIs
	// -------------------------

	requireState(indexFromLatest = 0): WorkspaceSnapshot {
		const snap = this.readSnapshot(WORKSPACE_STATE_ID, indexFromLatest);
		if (!snap) return logger.error('No snapshot found');
		return snap;
	},

	requireResource(resourceId: string, indexFromLatest = 0): string {
		return this.getResource(resourceId, indexFromLatest);
	},
};
