// A process's state saved to disk, so the next one can start from it rather
// than from the whole log. Only ever a cache: anything unexpected reads as none.

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import v8 from 'node:v8';
import {ulid} from 'ulid';

// Bumped whenever what a snapshot holds, or how it is laid out, changes.
const FORMAT = 1;

/** What a snapshot was written by: one that differs is never read. */
export type SnapshotKey = {
	format: number;
	// The serializer's own format follows the V8 version.
	v8: string;
	// The code that built the state, so a change to how any event applies
	// is never read back as the old result.
	build: string;
	// The actions and schema versions it could read.
	catalog: string;
	// Whatever else the caller's state depends on, such as a mode.
	scope: string;
};

const hashOf = (value: string | Buffer): string =>
	createHash('sha1').update(value).digest('hex');

/**
 * The build a module was loaded from, by its URL: a single-file binary's bundle
 * is the URL itself; a bundled directory is every script in it, so a split
 * chunk counts too. From sources (a loader such as tsx) nothing pins the code:
 * none, unless EPIQ_SNAPSHOT=1 asks for snapshots anyway.
 */
export const buildIdFor = (moduleUrl: string): string | null => {
	try {
		if (moduleUrl.startsWith('data:')) return hashOf(moduleUrl);

		const file = moduleUrl.startsWith('file:') ? fileURLToPath(moduleUrl) : '';
		if (/\.(m?js|cjs)$/.test(file)) {
			const dir = path.dirname(file);
			const hash = createHash('sha1');
			for (const name of fs.readdirSync(dir).sort()) {
				if (!/\.(m?js|cjs)$/.test(name)) continue;
				hash
					.update(name)
					.update('\0')
					.update(fs.readFileSync(path.join(dir, name)));
			}
			// The packages it imports are installed beside it, not bundled: the
			// versions resolved there decide what it reads too.
			for (const dependency of dependencyVersions(dir)) hash.update(dependency);
			return hash.digest('hex');
		}
	} catch {
		return null;
	}

	return process.env['EPIQ_SNAPSHOT'] === '1' ? 'sources' : null;
};

// Each runtime dependency the package beside `dir` names, as Node would
// resolve it from there: name and installed version.
const dependencyVersions = (dir: string): string[] => {
	const manifestPath = path.join(dir, '..', 'package.json');
	if (!fs.existsSync(manifestPath)) return [];

	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
		dependencies?: Record<string, string>;
	};

	return Object.keys(manifest.dependencies ?? {})
		.sort()
		.map(name => {
			for (let at = dir; ; at = path.dirname(at)) {
				const found = path.join(at, 'node_modules', name, 'package.json');
				if (fs.existsSync(found)) {
					const {version} = JSON.parse(fs.readFileSync(found, 'utf8')) as {
						version?: string;
					};
					return `${name}@${version ?? '?'}\n`;
				}
				if (path.dirname(at) === at) return `${name}@missing\n`;
			}
		});
};

let buildId: string | null | undefined;

/** The running build's id, from where this module was loaded. */
export const currentBuildId = (): string | null =>
	(buildId ??= buildIdFor(import.meta.url));

export const snapshotKey = ({
	actions,
	schemaVersions,
	scope,
	build = currentBuildId(),
}: {
	actions: readonly string[];
	schemaVersions: readonly number[];
	scope: string;
	build?: string | null;
}): SnapshotKey | null =>
	build === null
		? null
		: {
				format: FORMAT,
				v8: process.versions.v8,
				build,
				catalog: hashOf(
					JSON.stringify([[...actions].sort(), [...schemaVersions].sort()]),
				),
				scope,
		  };

const sameKey = (left: unknown, right: SnapshotKey): boolean =>
	JSON.stringify(left) === JSON.stringify(right);

const LENGTH_BYTES = 8;

const lengthOf = (bytes: number): Buffer => {
	const prefix = Buffer.alloc(LENGTH_BYTES);
	prefix.writeBigUInt64BE(BigInt(bytes));
	return prefix;
};

/**
 * Writes `parts` beside the file, then renames it over: a reader sees the old
 * snapshot or the new one, never half of either. Each part is serialized and
 * written on its own, so the peak is the largest part, not all of them.
 */
export const writeSnapshot = (
	filePath: string,
	key: SnapshotKey,
	parts: Record<string, unknown>,
): boolean => {
	const temporary = `${filePath}.${ulid()}.tmp`;
	let fd: number | null = null;

	try {
		fs.mkdirSync(path.dirname(filePath), {recursive: true});
		fd = fs.openSync(temporary, 'w');

		for (const value of [key, Object.keys(parts), ...Object.values(parts)]) {
			const bytes = v8.serialize(value);
			fs.writeSync(fd, lengthOf(bytes.length));
			fs.writeSync(fd, bytes);
		}

		fs.closeSync(fd);
		fd = null;
		fs.renameSync(temporary, filePath);
		return true;
	} catch {
		if (fd !== null) fs.closeSync(fd);
		fs.rmSync(temporary, {force: true});
		return false;
	}
};

/** The parts a snapshot written under `key` holds, or null for any other file. */
export const readSnapshot = (
	filePath: string,
	key: SnapshotKey,
): Record<string, unknown> | null => {
	try {
		const bytes = fs.readFileSync(filePath);
		let at = 0;
		const next = (): unknown => {
			if (at + LENGTH_BYTES > bytes.length) throw new Error('truncated');
			const length = Number(bytes.readBigUInt64BE(at));
			at += LENGTH_BYTES;
			if (at + length > bytes.length) throw new Error('truncated');
			const value = v8.deserialize(bytes.subarray(at, at + length));
			at += length;
			return value;
		};

		if (!sameKey(next(), key)) return null;

		const names = next();
		if (!Array.isArray(names)) return null;

		const parts: Record<string, unknown> = {};
		for (const name of names) parts[String(name)] = next();

		// Exactly what was written: trailing bytes mean some other file.
		return at === bytes.length ? parts : null;
	} catch {
		return null;
	}
};
