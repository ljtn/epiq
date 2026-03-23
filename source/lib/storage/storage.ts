import stringify from 'json-stringify-pretty-compact';
import path from 'node:path';
import {ulid} from 'ulid';
import {
	StorageNodeType,
	StorageNodeTypes,
	WorkspaceDiskNode,
	WorkspaceDiskNodeComposed,
} from '../model/storage-node.model.js';
import {clamp} from '../utils/number.js';
import {evenlySpacedRanks, midRank, rankBetween} from '../utils/rank.js';
import {fileManager} from './file-manager.js';
import {TEMPLATES} from './templates.js';
import {buildStoragePaths} from './path-manager.js';
import {SEED_RESOURCES} from './seed.js';

type Meta = {rootWorkspaceId: string};

type NodeDefinitionTemplate = {
	name?: string;
	nameId?: string;
	type: StorageNodeType;
	initialValue?: string;
	children?: NodeDefinitionTemplate[];
};

export const storage = {
	ROOT_DIR: '',
	EPIQ_DIR: '',
	RESOURCES_DIR: '',
	STORE_DIR: '',
	NODES_DIR: '',
	ORDER_DIR: '',
	META_PATH: '',

	setRootDir(rootDir: string) {
		const paths = buildStoragePaths(rootDir);
		this.ROOT_DIR = paths.ROOT_DIR;
		this.EPIQ_DIR = paths.EPIQ_DIR;
		this.RESOURCES_DIR = paths.RESOURCES_DIR;
		this.STORE_DIR = paths.STORE_DIR;
		this.NODES_DIR = paths.NODES_DIR;
		this.ORDER_DIR = paths.ORDER_DIR;
		this.META_PATH = paths.META_PATH;
	},

	// -------------------------
	// Idempotent bootstrap
	// -------------------------
	initStoreAtRoot(rootDir: string) {
		this.setRootDir(rootDir);

		fileManager.mkDir(this.EPIQ_DIR);
		fileManager.mkDir(this.RESOURCES_DIR);
		fileManager.mkDir(this.STORE_DIR);
		fileManager.mkDir(this.NODES_DIR);
		fileManager.mkDir(this.ORDER_DIR);

		this.ensureSeeds();
	},

	createWorkspace(rootDir = process.cwd()): WorkspaceDiskNodeComposed | null {
		this.initStoreAtRoot(rootDir);
		return this.createInitialWorkspace();
	},

	loadWorkspace(): WorkspaceDiskNodeComposed | null {
		const epiqFolder = fileManager.locateFolder('.epiq');

		if (!epiqFolder) {
			logger.info(
				'No .epiq folder found — creating new workspace in current directory',
			);
			return this.createWorkspace(process.cwd());
		}

		const rootDir = path.dirname(epiqFolder);

		this.initStoreAtRoot(rootDir);

		const meta = this.readMeta();
		if (!meta) {
			return this.createInitialWorkspace();
		}

		const ws = this.getNode(meta.rootWorkspaceId);
		if (!ws) {
			logger.error('Workspace root missing from store');
			return this.createInitialWorkspace();
		}

		return ws;
	},

	readMeta(): Meta | null {
		if (!fileManager.fileExists?.(this.META_PATH)) return null;

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

	getResource(
		resourceId: string | undefined,
		indexFromLatest = 0,
	): string | null {
		if (!resourceId) {
			logger.error('Missing id - unable to resolve resource');
			return null;
		}

		const versionId = this.resolveResourceVersion(resourceId, indexFromLatest);
		if (!versionId) {
			logger.error('Unable to resolve resource version for: ', resourceId);
			return null;
		}

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
		this.ensureSeedResource(SEED_RESOURCES.tag, 'Tag');
		this.ensureSeedResource(SEED_RESOURCES.assignees, 'Assignees');
		this.ensureSeedResource(SEED_RESOURCES.assignee, 'Assignee');
	},

	// -------------------------
	// Per-node files
	// -------------------------

	nodePath(id: string) {
		return path.join(this.NODES_DIR, `${id}.json`);
	},

	writeNodeFile(
		type: StorageNodeType,
		node: Pick<WorkspaceDiskNode, 'id' | 'name' | 'props'>,
	) {
		const onDisk: WorkspaceDiskNode = {
			id: node.id,
			type,
			name: node.name,
			props: node.props ?? {},
		};

		fileManager.writeToFile(
			this.nodePath(node.id),
			stringify(onDisk, {maxLength: 1, indent: 2}),
		);
	},

	readNodeFile(id: string): WorkspaceDiskNode | null {
		const p = this.nodePath(id);
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

	getNode(id: string): WorkspaceDiskNodeComposed | null {
		const node = this.readNodeFile(id);
		if (!node) return null;

		const children = this.listChildrenOrdered(id).map(e => e.childId);

		return {...node, children};
	},

	// -------------------------
	// Initial state
	// -------------------------

	createInitialWorkspace(): WorkspaceDiskNodeComposed | null {
		try {
			const swimlaneIds = TEMPLATES.swimlanes.map(name => {
				const node = this.createNodeFile(
					StorageNodeTypes.SWIMLANE,
					name,
					{},
					[],
				);
				return node.id;
			});

			const board = this.createNodeFile(
				StorageNodeTypes.BOARD,
				'Board',
				{},
				swimlaneIds,
			);

			const workspace = this.createNodeFile(
				StorageNodeTypes.WORKSPACE,
				'Workspace',
				{},
				[board.id],
			);

			this.writeMeta({rootWorkspaceId: workspace.id});

			return this.getNode(workspace.id);
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

		return {id, name: nameResId, children: initialChildren, props, type};
	},

	// -------------------------
	// Public mutations
	// -------------------------

	createNode({
		parentId,
		definition,
	}: {
		parentId: string;
		definition: NodeDefinitionTemplate;
	}): WorkspaceDiskNodeComposed | null {
		const nodeId = this.createNodeFromDefinitionNoLink(definition).id;
		const parentChildren = this.listChildrenOrdered(parentId);
		this.linkChildAt(parentId, nodeId, parentChildren.length);
		return this.getNode(nodeId);
	},

	createNodeFromDefinitionNoLink({
		name,
		nameId,
		initialValue,
		type,
		children,
	}: NodeDefinitionTemplate): {
		id: string;
	} {
		const nodeId = ulid();
		nameId = nameId ?? (name ? this.createResource(name).id : '');
		const valueId = this.createResource(initialValue ?? '').id;

		this.writeNodeFile(type, {
			id: nodeId,
			name: nameId,
			props: {value: valueId},
		});

		for (const [index, child] of (children ?? []).entries()) {
			const childId = this.createNodeFromDefinitionNoLink(child).id;
			this.linkChildAt(nodeId, childId, index);
		}

		return {id: nodeId};
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
		if (fromIndex < 0 || fromIndex >= fromChildren.length) {
			logger.error(`fromIndex ${fromIndex} out of bounds`);
			return null;
		}

		const movedId = fromChildren[fromIndex]!;
		this.unlinkChild(fromParentId, movedId);

		const toChildren = this.listChildrenOrdered(toParentId).map(e => e.childId);
		const idx = clamp(toIndex, 0, toChildren.length);

		this.linkChildAt(toParentId, movedId, idx);

		return {nodeId: movedId};
	},

	renameNodeTitle(nodeId: string, nextTitle: string) {
		const node = this.readNodeFile(nodeId);
		if (!node) return logger.error(`Node ${nodeId} not found`);

		const currentNameResId = node.name;

		const isSeeded = currentNameResId.startsWith('seed:');

		if (isSeeded) {
			const newTitleResId = this.createResource(nextTitle).id;
			this.writeNodeFile(node.type, {...node, name: newTitleResId});
		} else {
			this.updateResource(currentNameResId, nextTitle);
		}

		return {nodeId};
	},

	updateNodeValue(nodeId: string, nextValue: string) {
		const node = this.readNodeFile(nodeId);
		if (!node) return logger.error(`Node ${nodeId} not found`);

		const valueResId = node.props?.['value'];
		if (!valueResId) {
			return logger.error(`Node ${nodeId} missing props.value`);
		}

		this.updateResource(valueResId, nextValue);

		return {nodeId};
	},

	canDeleteNode(nodeId: string): boolean {
		const node = this.readNodeFile(nodeId);
		if (!node) return false;

		const nameResId = node.name ?? '';

		const isSeedLabel =
			nameResId.startsWith('seed:') ||
			(Object.values(SEED_RESOURCES) as readonly string[]).includes(nameResId);

		return !isSeedLabel;
	},
};
