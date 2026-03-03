import stringify from 'json-stringify-pretty-compact';
import path from 'node:path';
import {ulid} from 'ulid';
import {
	StorageNodeType,
	StorageNodeTypes,
	WorkspaceDiskNode,
	WorkspaceDiskNodeComposed,
} from '../model/storage-node.model.js';
import {nodeMapper} from '../utils/node-mapper.js';
import {clamp} from '../utils/number.js';
import {
	bigIntToHex,
	evenlySpacedRanks,
	HEX_LEN,
	hexToBigInt,
	MAX_RANK,
	midRank,
	rankBetween,
} from '../utils/rank.js';
import {fileManager} from './file-manager.js';
import {TEMPLATES} from './templates.js';

export const SEED_RESOURCES = {
	name: 'seed:fieldName:name',
	tags: 'seed:fieldName:tags',
	assignees: 'seed:fieldName:assignees',
} as const;

type Meta = {rootWorkspaceId: string};

export const storageManager = {
	ROOT_DIR: '',
	RESOURCES_DIR: '',
	STORE_DIR: '',
	NODES_DIR: '',
	ORDER_DIR: '',
	META_PATH: '',

	// -------------------------
	// Idempotent bootstrap
	// -------------------------
	initStoreAtRoot(rootDir: string) {
		this.ROOT_DIR = rootDir;

		const epiqDir = path.join(this.ROOT_DIR, '.epiq');

		// Ensure base folder exists
		fileManager.mkDir(epiqDir);

		this.RESOURCES_DIR = path.join(epiqDir, 'resources');
		fileManager.mkDir(this.RESOURCES_DIR);

		// Store dirs
		this.STORE_DIR = path.join(epiqDir, 'store');
		this.NODES_DIR = path.join(this.STORE_DIR, 'nodes');
		this.ORDER_DIR = path.join(this.STORE_DIR, 'order');
		this.META_PATH = path.join(this.STORE_DIR, 'meta.json');

		fileManager.mkDir(this.STORE_DIR);
		fileManager.mkDir(this.NODES_DIR);
		fileManager.mkDir(this.ORDER_DIR);

		// Ensure per-type node dirs exist
		for (const t of Object.values(StorageNodeTypes)) {
			fileManager.mkDir(this.nodesTypeDir(t as StorageNodeType));
		}

		// Ensure seeds exist (idempotent)
		this.ensureSeeds();
	},

	createWorkspace(): WorkspaceDiskNodeComposed | null {
		this.initStoreAtRoot(process.cwd());
		return this.createInitialWorkspace();
	},

	loadWorkspace(): WorkspaceDiskNodeComposed | null {
		const epiqFolder = fileManager.locateFolder('.epiq');

		if (!epiqFolder) {
			logger.error(
				'No .epiq folder found — creating new workspace in current directory',
			);
			return this.createWorkspace();
		}

		const rootDir = path.dirname(epiqFolder);

		this.initStoreAtRoot(rootDir);

		const meta = this.readMeta();
		if (!meta) {
			return this.createInitialWorkspace();
		}

		const ws = this.getNode(StorageNodeTypes.WORKSPACE, meta.rootWorkspaceId);
		if (!ws) {
			logger.error('Workspace root missing from store');
			return this.createInitialWorkspace();
		}

		return ws;
	},

	readMeta(): Meta | null {
		if (
			!fileManager.fileExists?.(this.META_PATH) &&
			!fileManager.readFile(this.META_PATH)
		)
			return null;

		try {
			return fileManager.readFileJSON<Meta>(this.META_PATH);
		} catch {
			return null;
		}
	},

	writeMeta(meta: Meta) {
		fileManager.writeToFile(
			this.META_PATH,
			stringify(meta, {maxLength: 1, indent: 2}),
		);
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
		const resolvedValue = value ?? '';
		fileManager.writeToFile(
			this.resourceVersionPath(id, versionId),
			resolvedValue,
		);
		return {value: resolvedValue, id, versionId};
	},

	updateResource(id: string, nextValue: string) {
		fileManager.mkDir(this.resourceFolder(id));
		const versionId = ulid();
		const resolvedValue = nextValue ?? '';
		fileManager.writeToFile(
			this.resourceVersionPath(id, versionId),
			resolvedValue,
		);
		return {value: resolvedValue, id, versionId};
	},

	getResource(resourceId: string | undefined, indexFromLatest = 0): string {
		if (!resourceId) {
			return logger.error('Missing id - unable to resolve resource');
		}

		const versionId = this.resolveResourceVersion(resourceId, indexFromLatest);
		if (!versionId) return logger.error('Unable to resolve resource version');

		const raw =
			fileManager.readFile(this.resourceVersionPath(resourceId, versionId)) ??
			'';
		return raw.replace(/\r?\n$/, '');
	},

	ensureSeedResource(resourceId: string, initialValue: string) {
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
	// Per-node files
	// -------------------------

	nodesTypeDir(type: StorageNodeType) {
		return path.join(this.NODES_DIR, type);
	},

	nodePath(type: StorageNodeType, id: string) {
		return path.join(this.nodesTypeDir(type), `${id}.json`);
	},

	writeNodeFile(
		type: StorageNodeType,
		node: Pick<WorkspaceDiskNode, 'id' | 'name' | 'props'>,
	) {
		const onDisk: WorkspaceDiskNode = {
			id: node.id,
			name: node.name,
			props: node.props ?? {},
		};

		fileManager.writeToFile(
			this.nodePath(type, node.id),
			stringify(onDisk, {maxLength: 1, indent: 2}),
		);
	},

	readNodeFile(type: StorageNodeType, id: string): WorkspaceDiskNode | null {
		const p = this.nodePath(type, id);
		const raw = fileManager.readFile(p);
		if (!raw) return null;
		try {
			return fileManager.readFileJSON<WorkspaceDiskNode>(p);
		} catch {
			return null;
		}
	},

	// -------------------------
	// Ordering representation (rank files)
	// -------------------------

	orderFolder(parentId: string) {
		return path.join(this.ORDER_DIR, parentId);
	},

	parseOrderFileName(name: string): {rank: string; childId: string} | null {
		// <rank>.<childId>.link
		if (!name.endsWith('.link')) return null;
		const base = name.slice(0, -'.link'.length);
		const firstDot = base.indexOf('.');
		if (firstDot <= 0) return null;
		const rank = base.slice(0, firstDot);
		const childId = base.slice(firstDot + 1);
		if (!rank || !childId) return null;
		return {rank, childId};
	},

	listChildrenOrdered(
		parentId: string,
	): {rank: string; childId: string; file: string}[] {
		const folder = this.orderFolder(parentId);
		if (!fileManager.dirExists(folder)) return [];
		return fileManager
			.listDir(folder)
			.filter((n: string) => n.endsWith('.link'))
			.map((file: string) => {
				const parsed = this.parseOrderFileName(file);
				return parsed ? {...parsed, file} : null;
			})
			.filter(Boolean)
			.sort((a, b) =>
				a!.rank < b!.rank ? -1 : a!.rank > b!.rank ? 1 : 0,
			) as any;
	},

	rankBetween(prev?: string, next?: string): string {
		if (!prev && !next) {
			// Center of entire space
			return bigIntToHex(MAX_RANK / 2n, HEX_LEN);
		}

		const a = prev ? hexToBigInt(prev) : 0n;
		const b = next ? hexToBigInt(next) : MAX_RANK;

		if (b <= a) {
			// Recovery fallback
			return bigIntToHex(MAX_RANK / 2n, HEX_LEN);
		}

		const mid = (a + b) / 2n;

		// No room between them
		if (mid === a || mid === b) return '';

		return bigIntToHex(mid, HEX_LEN);
	},

	rebalanceOrder(parentId: string) {
		const folder = this.orderFolder(parentId);
		fileManager.mkDir(folder);

		const entries = this.listChildrenOrdered(parentId);
		if (!entries.length) return;

		const ranks = evenlySpacedRanks(entries.length);

		for (let i = 0; i < entries.length; i++) {
			const childId = entries[i]!.childId;
			const rank = ranks[i]!;
			const nextFile = `${rank}.${childId}.link`;

			const oldPath = path.join(folder, entries[i]!.file);
			const newPath = path.join(folder, nextFile);

			fileManager.moveFile(oldPath, newPath, {overwrite: true});
		}
	},

	linkChildAt(parentId: string, childId: string, toIndex: number) {
		const folder = this.orderFolder(parentId);
		fileManager.mkDir(folder);

		const entries = this.listChildrenOrdered(parentId);
		const idx = clamp(toIndex, 0, entries.length);

		const prev = idx === 0 ? undefined : entries[idx - 1]?.rank;
		const next = idx === entries.length ? undefined : entries[idx]?.rank;

		let rank = rankBetween(prev, next);

		if (!rank) {
			// no space: rebalance and retry once
			this.rebalanceOrder(parentId);

			const after = this.listChildrenOrdered(parentId);
			const prev2 = idx === 0 ? undefined : after[idx - 1]?.rank;
			const next2 = idx === after.length ? undefined : after[idx]?.rank;

			rank = rankBetween(prev2, next2) || midRank();
		}

		fileManager.writeToFile(path.join(folder, `${rank}.${childId}.link`), '');
	},

	unlinkChild(parentId: string, childId: string) {
		const folder = this.orderFolder(parentId);
		if (!fileManager.dirExists(folder)) return;

		const entries = this.listChildrenOrdered(parentId);
		const hit = entries.find(e => e.childId === childId);
		if (!hit) return;

		fileManager.rmFile?.(path.join(folder, hit.file));
	},

	// ---------- node access ----------

	getNode(type: StorageNodeType, id: string): WorkspaceDiskNodeComposed | null {
		const node = this.readNodeFile(type, id);
		if (!node) return null;

		const children = this.listChildrenOrdered(id).map(e => e.childId);

		return {...node, children};
	},

	// -------------------------
	// Initial state
	// -------------------------

	createInitialWorkspace(): WorkspaceDiskNodeComposed | null {
		try {
			// Swimlanes
			const swimlaneIds = TEMPLATES.swimlanes.map(name => {
				const node = this.createNodeFile(
					StorageNodeTypes.SWIMLANE,
					name,
					{},
					[],
				);
				return node.id;
			});

			// Board
			const board = this.createNodeFile(
				StorageNodeTypes.BOARD,
				'Board',
				{},
				swimlaneIds,
			);

			// Workspace
			const workspace = this.createNodeFile(
				StorageNodeTypes.WORKSPACE,
				'Workspace',
				{},
				[board.id],
			);

			this.writeMeta({rootWorkspaceId: workspace.id});

			return this.getNode(StorageNodeTypes.WORKSPACE, workspace.id);
		} catch (e) {
			logger.error('Failed to create initial workspace', e);
			return null;
		}
	},

	createNodeFile(
		type: StorageNodeType,
		name: string,
		props: Record<string, string> = {},
		initialChildren: string[] = [],
	): WorkspaceDiskNodeComposed {
		const id = ulid();
		const nameResId = this.createResource(name).id;

		this.writeNodeFile(type, {id, name: nameResId, props});

		for (let i = 0; i < initialChildren.length; i++) {
			this.linkChildAt(id, initialChildren[i]!, i);
		}

		return {id, name: nameResId, children: initialChildren, props};
	},

	// -------------------------
	// Public mutations
	// -------------------------

	createNode(
		parentId: string,
		name: string,
		nodeType: StorageNodeType,
		children?: {id?: string; initialValue: string}[],
	): WorkspaceDiskNodeComposed {
		const childNodeType = nodeMapper.toChildStorageNodeType(nodeType);
		if (!childNodeType) {
			throw new Error(`Unable to map child node type from ${nodeType}`);
		}

		// 1) Create child nodes and collect their ids
		const childIds: string[] = (children ?? []).map(child => {
			// Case 1: FIELD children => label/value
			if (childNodeType === StorageNodeTypes.FIELD) {
				// IMPORTANT:
				// - label is a resource-id reference (seed or ULID) => store it directly in `name`
				// - value is always a new (versioned) resource => store in props.value
				const labelResId = child.id ?? SEED_RESOURCES.name;
				const valueResId = this.createResource(child.initialValue).id;

				const fieldId = ulid();
				this.writeNodeFile(StorageNodeTypes.FIELD, {
					id: fieldId,
					name: labelResId, // keep seed reference, do NOT resolve text
					props: {value: valueResId},
				});

				return fieldId;
			}

			// Case 2: non-FIELD children => normal nodes
			const childId = ulid();
			const childNameResId = this.createResource(child.initialValue).id;

			this.writeNodeFile(childNodeType, {
				id: childId,
				name: childNameResId,
				props: {},
			});

			// children of these created nodes start empty; ordering folder will be empty
			return childId;
		});

		// 2) Create the node itself
		const nodeId = ulid();
		const nodeNameResId = this.createResource(name).id;

		this.writeNodeFile(nodeType, {
			id: nodeId,
			name: nodeNameResId,
			props: {},
		});

		// 3) Initialize this node's own children ordering (if any)
		for (let i = 0; i < childIds.length; i++) {
			this.linkChildAt(nodeId, childIds[i]!, i);
		}

		// 4) Attach the new node to the parent ordering (append)
		const parentChildren = this.listChildrenOrdered(parentId);
		this.linkChildAt(parentId, nodeId, parentChildren.length);

		// 5) Return the created node as callers expect (with derived children)
		const created = this.getNode(nodeType, nodeId);
		if (!created) return logger.error('Unable to create node');
		return created;
	},

	move({
		fromParentId,
		fromIndex,
		toParentId,
		toIndex,
	}: {
		fromParentId: string;
		fromIndex: number;
		toParentId: string;
		toIndex: number;
	}): {nodeId: string} | null {
		const fromChildren = this.listChildrenOrdered(fromParentId).map(
			e => e.childId,
		);
		if (fromIndex < 0 || fromIndex >= fromChildren.length)
			return logger.error(`fromIndex ${fromIndex} out of bounds`);

		const movedId = fromChildren[fromIndex]!;
		this.unlinkChild(fromParentId, movedId);

		// compute target index against current target list (after unlink if same parent)
		const toChildren = this.listChildrenOrdered(toParentId).map(e => e.childId);
		const effective = fromParentId === toParentId ? toChildren : toChildren;

		const idx = clamp(toIndex, 0, effective.length);
		this.linkChildAt(toParentId, movedId, idx);

		return {nodeId: movedId};
	},

	renameNodeTitle(
		nodeType: StorageNodeType,
		nodeId: string,
		nextTitle: string,
	): {nodeId: string} {
		const node = this.readNodeFile(nodeType, nodeId);
		if (!node) return logger.error(`Node ${nodeId} not found in ${nodeType}`);

		const currentNameResId = node.name;
		if (!currentNameResId) return logger.error(`Node ${nodeId} missing name`);

		// Fork if seeded, so renaming doesn’t rename the shared seed
		const isSeeded = currentNameResId.startsWith('seed:');
		if (isSeeded) {
			const newTitleResId = this.createResource(nextTitle).id;
			this.writeNodeFile(nodeType, {...node, name: newTitleResId});
		} else {
			this.updateResource(currentNameResId, nextTitle);
		}

		return {nodeId};
	},

	updateNodeValue(
		nodeType: StorageNodeType,
		nodeId: string,
		nextValue: string,
	) {
		const node = this.readNodeFile(nodeType, nodeId);
		if (!node) {
			return logger.error(`Node ${nodeId} not found in ${nodeType}`);
		}

		const currentValueResId = node.props?.['value'];
		if (!currentValueResId) {
			return logger.error(
				`Node ${nodeId} has no value resource (props.value missing)`,
			);
		}

		// Append new version to the existing value resource
		this.updateResource(currentValueResId, nextValue);

		return {nodeId};
	},
};
