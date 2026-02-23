import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

export const fileManager = {
	writeToFile: (filePath: string, content: unknown) => {
		try {
			const dir = path.dirname(filePath);
			if (!existsSync(dir)) {
				mkdirSync(dir, {recursive: true});
			}

			const data =
				typeof content === 'string'
					? content
					: JSON.stringify(content, null, 2);

			writeFileSync(filePath, data, 'utf-8');
		} catch (e) {
			logger.error(`Failed to write file at ${filePath}:`, e);
		}
	},

	readFile: (filePath: string): string | null => {
		try {
			return readFileSync(filePath, 'utf-8');
		} catch (e) {
			logger.error(`Failed to read file at ${filePath}:`, e);
			return null;
		}
	},

	readFileJSON<T = unknown>(filePath: string): T | null {
		try {
			const raw = fileManager.readFile(filePath);
			if (raw === null) return null;
			return JSON.parse(raw) as T;
		} catch (e) {
			logger.error(`Failed to read JSON at ${filePath}:`, e);
			return null;
		}
	},

	dirExists: (dir: string): boolean => {
		try {
			return existsSync(dir) && statSync(dir).isDirectory();
		} catch {
			return false;
		}
	},

	mkDir: (dir: string) => {
		return mkdirSync(dir, {recursive: true});
	},

	locateFolder: (folderName: string): string | null => {
		let currentPath = process.cwd();
		const {root} = path.parse(currentPath);

		while (true) {
			const candidatePath = path.join(currentPath, folderName);

			try {
				if (
					existsSync(candidatePath) &&
					statSync(candidatePath).isDirectory()
				) {
					return candidatePath; // full path including folder
				}
			} catch {
				// ignore (race/permission/etc)
			}

			if (currentPath === root) break;
			currentPath = path.dirname(currentPath);
		}

		return null;
	},

	readFirstJSON<T>(folderPath: string): T | null {
		try {
			if (!fileManager.dirExists(folderPath)) return null;

			// deterministic: alphabetical (ULIDs will be time-sortable)
			const firstJsonName = readdirSync(folderPath)
				.filter(name => name.endsWith('.json'))
				.sort()[0];

			if (!firstJsonName) return null;

			const filePath = path.join(folderPath, firstJsonName);
			return fileManager.readFileJSON<T>(filePath);
		} catch (e) {
			logger.error(`Could not read first JSON in folder ${folderPath}`, e);
			return null;
		}
	},

	// handy for your snapshot approach
	listDir: (folderPath: string): string[] => {
		try {
			if (!fileManager.dirExists(folderPath)) return [];
			return readdirSync(folderPath);
		} catch (e) {
			logger.error(`Failed to list dir ${folderPath}`, e);
			return [];
		}
	},
};
