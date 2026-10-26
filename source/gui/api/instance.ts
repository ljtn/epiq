import fs from 'node:fs';
import path from 'node:path';

// The port a GUI asks for first. Settable, since the websocket origin guard
// needs it to match a forwarded port.
export const PREFERRED_GUI_PORT = Number(process.env['EPIQ_GUI_PORT']) || 3710;

export const INSTANCE_PATH = '/api/instance';
export const INSTANCE_APP = 'epiq';

export type GuiInstance = {
	app: typeof INSTANCE_APP;
	repoRoot: string;
	version: string;
	pid: number;
};

/** Canonical path for comparing projects; falls back to `resolve` rather than throw. */
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
 * Who holds `port`, or null for any answer that isn't a usable epiq. Times
 * out, so a silent foreign server can't stall boot.
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
