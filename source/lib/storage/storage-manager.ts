import stringify from 'json-stringify-pretty-compact';
import path from 'node:path';
import {ulid} from 'ulid';
import {fileManager} from './file-manager.js';
import {nodeMapper} from '../utils/node-mapper.js';
import {
	StorageNodeType,
	StorageNodeTypes,
	WorkspaceDiskNode,
	WorkspaceSnapshot,
} from '../model/storage-node.model.js';
import {TEMPLATES} from './templates.js';

// logical state “resource” id (single stream of versions)
const WORKSPACE_STATE_ID = 'workspace';

export const SEED_RESOURCES = {
	name: 'seed:fieldName:name',
	tags: 'seed:fieldName:tags',
	assignees: 'seed:fieldName:assignees',
} as const;

export const storageManager = {
	ROOT_DIR: '',
	RESOURCES_DIR: '',
	STATE_DIR: '',
	snapshot: null as WorkspaceSnapshot | null,

	createWorkspace() {
		// ... implement create workspace
	},

	loadWorkspace() {
		const root = fileManager.locateFolder('.epiq');
		if (!root) {
			logger.error('No project path found');
			return this.createWorkspace();
		}

		this.ROOT_DIR = root;
		this.RESOURCES_DIR = path.join(this.ROOT_DIR, 'snapshots', 'resources');
		this.STATE_DIR = path.join(this.ROOT_DIR, 'snapshots', 'state');

		fileManager.mkDir(this.STATE_DIR);
		fileManager.mkDir(this.RESOURCES_DIR);
		fileManager.mkDir(this.stateFolder(WORKSPACE_STATE_ID));

		// Create seeded fields
		this.ensureSeeds();

		const snap = this.readLatestSnapshot() ?? this.createInitialSnapshot();
		if (!snap) {
			logger.error('Could not initialize workspace snapshot');
			return null;
		}

		this.snapshot = snap;

		const ws = this.getNode(StorageNodeTypes.WORKSPACE, snap.rootWorkspaceId);
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
		this.ensureSeedResource(SEED_RESOURCES.assignees, 'Assignees');
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
		const id = ulid();
		fileManager.mkDir(this.resourceFolder(id));

		const versionId = ulid();
		fileManager.writeToFile(
			this.resourceVersionPath(id, versionId),
			value ?? '',
		);

		return {value: value ?? '', id, versionId};
	},

	updateResource(id: string, nextValue: string) {
		fileManager.mkDir(this.resourceFolder(id));

		const versionId = ulid();
		fileManager.writeToFile(
			this.resourceVersionPath(id, versionId),
			nextValue ?? '',
		);

		return {value: nextValue ?? '', id: id, versionId};
	},

	getResource(resourceId: string | undefined, indexFromLatest = 0): string {
		if (!resourceId)
			return logger.error('Missing id - unable to resolve resource');

		const versionId = this.resolveResourceVersion(resourceId, indexFromLatest);
		if (!versionId) return logger.error('Unable to resolve resource version');

		const raw =
			fileManager.readFile(this.resourceVersionPath(resourceId, versionId)) ??
			'';
		return raw.replace(/\r?\n$/, '');
	},

	// ---------- node access ----------
	requireSnapshot(): WorkspaceSnapshot {
		if (!this.snapshot) return logger.error('Snapshot not loaded');
		return this.snapshot;
	},

	getNode(type: StorageNodeType, id: string): WorkspaceDiskNode | null {
		const snap = this.requireSnapshot();
		return snap.nodes[type][id] ?? null;
	},

	// ---------- initial state ----------
	createInitialSnapshot(): WorkspaceSnapshot | null {
		try {
			const draft = this.emptySnapshotDraft();

			const swimlanesIds = TEMPLATES.swimlanes.map(
				name =>
					this.createNodeInMemory(draft, StorageNodeTypes.SWIMLANE, {
						name,
						children: [],
						props: {},
					}).id,
			);
			logger.debug(swimlanesIds);

			const board = this.createNodeInMemory(draft, StorageNodeTypes.BOARD, {
				name: 'Board',
				children: swimlanesIds,
				props: {},
			});
			const workspace = this.createNodeInMemory(
				draft,
				StorageNodeTypes.WORKSPACE,
				{
					name: 'Workspace',
					children: [board.id],
					props: {},
				},
			);

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
				[StorageNodeTypes.WORKSPACE]: {},
				[StorageNodeTypes.BOARD]: {},
				[StorageNodeTypes.SWIMLANE]: {},
				[StorageNodeTypes.ISSUE]: {},
				[StorageNodeTypes.FIELD]: {},
			},
		};
	},

	// ---------- in-memory node creation ----------
	createNodeInMemory(
		draft: WorkspaceSnapshot,
		nodeType: StorageNodeType,
		{
			name,
			children,
			props,
		}: {
			name: string;
			children?: string[];
			props?: Record<string, string>;
		},
	): WorkspaceDiskNode {
		const id = ulid();

		const node: WorkspaceDiskNode = {
			id,
			name: this.createResource(name).id,
			children: children ?? [],
			props: props ?? {},
		};

		draft.nodes[nodeType][id] = node;
		return node;
	},

	mutateState<T>(mutator: (draftWs: WorkspaceSnapshot) => T): {
		snap: WorkspaceSnapshot;
		result: T;
	} {
		const current = this.requireSnapshot();
		const draftWs = structuredClone(current);
		const result = mutator(draftWs);
		const snap = this.writeSnapshot(draftWs);
		return {snap, result};
	},

	createNode(
		parentId: string,
		name: string,
		nodeType: StorageNodeType,
		children?: {id?: string; initialValue: string}[],
	): WorkspaceDiskNode {
		const {snap, result: nodeId} = this.mutateState(draft => {
			const childNodeType = nodeMapper.toChildNodeType(nodeType);

			const childIds: string[] = (children ?? []).map(child => {
				if (!childNodeType) {
					throw new Error(`Unable to map child node type from ${nodeType}`);
				}

				// ✅ Case 1: FIELD children => label/value
				if (childNodeType === StorageNodeTypes.FIELD) {
					const labelResId = child.id ?? SEED_RESOURCES.name;
					const labelText = this.getResource(labelResId) || 'Field';
					const valueResId = this.createResource(child.initialValue).id;

					return this.createNodeInMemory(draft, childNodeType, {
						name: labelText,
						children: [],
						props: {value: valueResId},
					}).id;
				}

				// ✅ Case 2: non-FIELD children => normal nodes
				// (swimlanes, issues, boards, etc)
				return this.createNodeInMemory(draft, childNodeType, {
					name: child.initialValue,
					children: [],
					props: {},
				}).id;
			});

			const node = this.createNodeInMemory(draft, nodeType, {
				name,
				children: childIds,
				props: {},
			});

			const parentType = nodeMapper.toParentNodeType(nodeType);
			if (!parentType) {
				throw new Error(`Parent node type not found for ${nodeType}`);
			}

			const parent = draft.nodes[parentType][parentId];
			if (!parent) {
				throw new Error(`Parent ${parentId} not found in ${parentType}`);
			}

			draft.nodes[parentType][parentId] = {
				...parent,
				children: [...parent.children, node.id],
			};

			return node.id;
		});

		const newNode = snap.nodes[nodeType][nodeId];
		if (!newNode) return logger.error('Unable to create node');
		return newNode;
	},

	// ---------- move ----------
	move({
		parentType,
		fromParentId,
		fromIndex,
		toParentId,
		toIndex,
	}: {
		parentType: StorageNodeType;
		fromParentId: string;
		fromIndex: number;
		toParentId: string;
		toIndex: number;
	}): {snap: WorkspaceSnapshot; nodeId: string} | null {
		const {result, snap} = this.mutateState(draft => {
			const fromParent = draft.nodes[parentType][fromParentId];
			const toParent = draft.nodes[parentType][toParentId];

			if (!fromParent)
				return logger.error(
					`fromParent ${fromParentId} not found in ${parentType}`,
				);

			if (!toParent)
				return logger.error(
					`toParent ${toParentId} not found in ${parentType}`,
				);

			if (fromIndex < 0 || fromIndex >= fromParent.children.length)
				return logger.error(`fromIndex ${fromIndex} out of bounds`);

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

		if (!result) return null;

		return {snap, nodeId: result};
	},

	renameNodeTitle(
		nodeType: StorageNodeType,
		nodeId: string,
		nextTitle: string,
	) {
		const {result, snap} = this.mutateState(ws => {
			const node = ws.nodes[nodeType][nodeId];
			if (!node) return logger.error(`Node ${nodeId} not found in ${nodeType}`);

			const currentNameResId = node.name;
			if (!currentNameResId) return logger.error(`Node ${nodeId} missing name`);

			// Fork if seeded, so renaming doesn’t rename the shared seed
			const isSeeded = currentNameResId.startsWith('seed:');
			if (isSeeded) {
				const newTitleResId = this.createResource(nextTitle).id;
				ws.nodes[nodeType][nodeId] = {
					...node,
					name: newTitleResId,
				};
				return nodeId;
			}

			// Normal case: append a new version to the existing title resource
			this.updateResource(currentNameResId, nextTitle);
			return nodeId;
		});

		return nodeId ? {snap, nodeId: result} : null;
	},
};
