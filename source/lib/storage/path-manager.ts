import path from 'node:path';
type StoragePaths = {
	ROOT_DIR: string;
	EPIQ_DIR: string;
	RESOURCES_DIR: string;
	STORE_DIR: string;
	NODES_DIR: string;
	ORDER_DIR: string;
	META_PATH: string;
};

export const buildStoragePaths = (rootDir: string): StoragePaths => {
	const EPIQ_DIR = path.join(rootDir, '.epiq');
	const STORE_DIR = path.join(EPIQ_DIR, 'store');

	return {
		ROOT_DIR: rootDir,
		EPIQ_DIR,
		RESOURCES_DIR: path.join(EPIQ_DIR, 'resources'),
		STORE_DIR,
		NODES_DIR: path.join(STORE_DIR, 'nodes'),
		ORDER_DIR: path.join(STORE_DIR, 'order'),
		META_PATH: path.join(STORE_DIR, 'meta.json'),
	};
};
