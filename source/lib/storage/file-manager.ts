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
	writeToFile: (filePath: string, content: string) => {
		try {
			const dir = path.dirname(filePath);
			if (!existsSync(dir)) {
				mkdirSync(dir, {recursive: true});
			}
			writeFileSync(filePath, content, 'utf-8');
		} catch (e) {
			logger.error(`Failed to create file at ${filePath}:`, e);
		}
	},

	readFile: (filePath: string): any | null => {
		try {
			return readFileSync(filePath, 'utf-8');
		} catch (e) {
			logger.error(`Failed to read file at ${filePath}:`, e);
			return '';
		}
	},

	readFileJSON(filePath: string): any | null {
		try {
			return JSON.parse(this.readFile(filePath));
		} catch (e) {
			logger.error(`Failed to read JSON at ${filePath}:`, e);
			return '';
		}
	},

	dirExists(dir: string) {
		return existsSync(dir) && statSync(dir).isDirectory();
	},
	mkDir(dir: string) {
		return mkdirSync(dir, {recursive: true});
	},

	locateFolder: (folderName: string): string | null => {
		let currentPath = process.cwd();
		const {root} = path.parse(currentPath);

		while (true) {
			const candidatePath = path.join(currentPath, folderName);

			if (existsSync(candidatePath) && statSync(candidatePath).isDirectory()) {
				return candidatePath; // <-- return full folder path
			}

			if (currentPath === root) {
				break;
			}

			currentPath = path.dirname(currentPath);
		}

		return null;
	},

	readFirstJSON<T>(folderPath: string): T | null {
		if (!existsSync(folderPath)) return null;

		const entries = readdirSync(folderPath, {withFileTypes: true});

		const firstFile = entries.find(e => e.isFile() && e.name.endsWith('.json'));
		if (!firstFile) return null;

		const filePath = path.join(folderPath, firstFile.name);

		try {
			const content = readFileSync(filePath, 'utf-8');
			return JSON.parse(content) as T;
		} catch (e) {
			logger.error(`Could not read/parse json file at ${filePath}`, e);
			return null;
		}
	},
};
