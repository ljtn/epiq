import fs from 'node:fs';
import path from 'node:path';

// The port a GUI asks for first. A second epiq on the same machine only lands
// somewhere else because this one was taken, which is the whole reason an
// instance needs to be identifiable.
export const PREFERRED_GUI_PORT = 3710;

export const INSTANCE_PATH = '/api/instance';
export const INSTANCE_APP = 'epiq';

export type GuiInstance = {
	app: typeof INSTANCE_APP;
	repoRoot: string;
	version: string;
	pid: number;
};

/**
 * Two paths naming the same project have to compare equal, so a symlinked
 * checkout or a trailing slash cannot make one epiq look like a different one.
 * Falls back to `resolve` when the path cannot be read — better a comparison
 * that might miss than a throw on the boot path.
 */
export const canonicalRepoRoot = (repoRoot: string): string => {
	try {
		return fs.realpathSync(path.resolve(repoRoot));
	} catch {
		return path.resolve(repoRoot);
	}
};

const isGuiInstance = (value: unknown): value is GuiInstance => {
	const candidate = value as Partial<GuiInstance> | null;

	return (
		typeof candidate === 'object' &&
		candidate !== null &&
		candidate.app === INSTANCE_APP &&
		typeof candidate.repoRoot === 'string' &&
		typeof candidate.version === 'string' &&
		typeof candidate.pid === 'number'
	);
};

/**
 * Who holds `port`, or null for "nobody I can use".
 *
 * Null covers every unhappy answer alike — nothing listening, something that
 * is not epiq, a hang, a body that is not the shape above — because the caller
 * does the same thing in all of them: carry on and start its own server. The
 * timeout matters: a foreign server that accepts the socket and never replies
 * would otherwise stall the boot it was meant to speed up.
 */
export const probeGuiInstance = async (
	port: number,
	timeoutMs = 500,
): Promise<GuiInstance | null> => {
	const abort = new AbortController();
	const timer = setTimeout(() => abort.abort(), timeoutMs);

	try {
		const response = await fetch(`http://127.0.0.1:${port}${INSTANCE_PATH}`, {
			signal: abort.signal,
		});

		if (!response.ok) return null;

		const body: unknown = await response.json();

		return isGuiInstance(body) ? body : null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
};
