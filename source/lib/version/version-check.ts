import chalk from 'chalk';
import {theme} from '../theme/themes.js';

export type VersionStatus = {
	current: string;
	latest: string | null;
	updateAvailable: boolean;
};

const NPM_LATEST_URL = 'https://registry.npmjs.org/epiq/latest';

let cachedStatus: VersionStatus | null = null;
let cachedAt = 0;

const CACHE_MS = 1000 * 60 * 60 * 24;

const normalizeVersion = (version: string) => version.replace(/^v/, '');

const compareVersions = (a: string, b: string) => {
	const aParts = normalizeVersion(a).split('.').map(Number);
	const bParts = normalizeVersion(b).split('.').map(Number);

	for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
		const aPart = aParts[i] ?? 0;
		const bPart = bParts[i] ?? 0;

		if (aPart > bPart) return 1;
		if (aPart < bPart) return -1;
	}

	return 0;
};

export const getVersionStatus = async (
	current: string,
): Promise<VersionStatus> => {
	if (process.env['IS_CI'] === 'true') {
		return {current: '1.2.3', latest: '1.2.3', updateAvailable: false};
	}

	if (cachedStatus && Date.now() - cachedAt < CACHE_MS) {
		return cachedStatus;
	}

	try {
		const response = await fetch(NPM_LATEST_URL);

		if (!response.ok) {
			throw new Error(`Failed to fetch latest version: ${response.status}`);
		}

		const pkg = (await response.json()) as {version?: string};
		const latest = pkg.version ?? null;

		const status: VersionStatus = {
			current,
			latest,
			updateAvailable: latest ? compareVersions(latest, current) > 0 : false,
		};

		cachedStatus = status;
		cachedAt = Date.now();

		return status;
	} catch {
		return {
			current,
			latest: null,
			updateAvailable: false,
		};
	}
};

export const renderVersionDiff = (current: string, latest: string) => {
	const c = current.split('.');
	const l = latest.split('.');

	const diffStartIndex = l.findIndex((x, i) => x != c[i]);

	return l
		.map((x, i) =>
			i >= diffStartIndex
				? chalk.hex(theme.accent).dim(x)
				: chalk.hex(theme.secondary).dim(x),
		)
		.join(chalk.hex(theme.secondary2).dim('.'));
};
