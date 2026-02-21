import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
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

	locateFolder: (targetName: string): string | null => {
		let currentPath = process.cwd();
		const {root} = path.parse(currentPath);
		while (true) {
			const candidatePath = path.join(currentPath, targetName);
			if (existsSync(candidatePath)) {
				return currentPath;
			}

			if (currentPath === root) {
				break;
			}

			currentPath = path.dirname(currentPath);
		}

		return null;
	},
};
