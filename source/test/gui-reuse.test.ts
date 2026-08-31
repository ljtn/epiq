import {beforeEach, describe, expect, it, vi} from 'vitest';
import {succeeded} from '../lib/model/result-types.js';

vi.mock('../gui/api/instance.js', async importOriginal => ({
	// Keep the real canonicalRepoRoot: pairing a probe result with it is the
	// part worth testing, and stubbing it would test nothing.
	...(await importOriginal<typeof import('../gui/api/instance.js')>()),
	probeGuiInstance: vi.fn(),
}));

vi.mock('../gui/api/api-server.js', () => ({startGuiServer: vi.fn()}));
vi.mock('../gui/open-browser.js', () => ({openBrowser: vi.fn()}));
vi.mock('../lib/config/actor-env.js', () => ({
	resolveEnvActor: () => succeeded('actor', null),
}));
vi.mock('../lib/config/user-config.js', () => ({
	loadSettingsFromConfig: () => succeeded('settings', {}),
}));
vi.mock('../lib/state/settings.state.js', () => ({
	patchSettingsState: vi.fn(),
}));

import {startGuiServer} from '../gui/api/api-server.js';
import {
	canonicalRepoRoot,
	PREFERRED_GUI_PORT,
	probeGuiInstance,
} from '../gui/api/instance.js';
import {startGui} from '../gui/init.js';
import {openBrowser} from '../gui/open-browser.js';

const REPO = process.cwd();

const instance = (repoRoot: string) => ({
	app: 'epiq' as const,
	repoRoot: canonicalRepoRoot(repoRoot),
	version: '1.6.1',
	pid: 1,
});

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(startGuiServer).mockResolvedValue(
		succeeded('started', {
			url: 'http://127.0.0.1:9999',
			server: null as never,
		}),
	);
});

describe('startGui', () => {
	// The point of the whole thing: a second server would get an ephemeral port,
	// and browser storage is scoped to the origin, so its panel widths and lane
	// state would start empty.
	it('opens the running GUI instead of starting a second one', async () => {
		vi.mocked(probeGuiInstance).mockResolvedValue(instance(REPO));

		const result = await startGui({repoRoot: REPO});

		expect(startGuiServer).not.toHaveBeenCalled();
		expect(openBrowser).toHaveBeenCalledWith(
			`http://127.0.0.1:${PREFERRED_GUI_PORT}`,
		);
		expect(result.value?.url).toBe(`http://127.0.0.1:${PREFERRED_GUI_PORT}`);
	});

	// Taking the port from another project's board is a decision for TYR7186,
	// not something booting should do on its own.
	it('starts its own server when the port serves a different project', async () => {
		vi.mocked(probeGuiInstance).mockResolvedValue(instance('/somewhere/else'));

		await startGui({repoRoot: REPO});

		expect(startGuiServer).toHaveBeenCalledOnce();
		expect(openBrowser).toHaveBeenCalledWith('http://127.0.0.1:9999');
	});

	it('starts its own server when the port holds something that is not epiq', async () => {
		vi.mocked(probeGuiInstance).mockResolvedValue(null);

		await startGui({repoRoot: REPO});

		expect(startGuiServer).toHaveBeenCalledOnce();
	});

	// A symlinked checkout is the same project, and must not read as a rival.
	it('reuses when the paths differ only by a symlink or trailing slash', async () => {
		vi.mocked(probeGuiInstance).mockResolvedValue(instance(REPO));

		await startGui({repoRoot: `${REPO}/`});

		expect(startGuiServer).not.toHaveBeenCalled();
	});
});
