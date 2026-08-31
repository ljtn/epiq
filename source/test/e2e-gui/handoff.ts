import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

// Written by serve.ts, read by the Playwright fixture. A file rather than an
// env var because the server runs as a separate process from the test workers.
//
// Keyed by checkout, because one fixed path is shared by every run on the
// machine: a second run's setup and teardown both delete it, and the first
// run's tests then fail to open it. Deterministic rather than random, since
// each worker resolves this independently. `EPIQ_GUI_E2E_HANDOFF` overrides it
// for two runs that really do share a checkout.
const handoffFileName = (): string => {
	const key = crypto
		.createHash('sha256')
		.update(process.cwd())
		.digest('hex')
		.slice(0, 12);

	return `epiq-gui-e2e-handoff-${key}.json`;
};

export const HANDOFF_PATH =
	process.env['EPIQ_GUI_E2E_HANDOFF'] ??
	path.join(os.tmpdir(), handoffFileName());

// Each Playwright worker gets its own server, and so its own handoff file.
export const handoffPathFor = (workerIndex: number): string =>
	HANDOFF_PATH.replace(/\.json$/, `-${workerIndex}.json`);

export type Handoff = {
	baseUrl: string;
	repoRoot: string;
	// A second server over a directory with no epiq project, so the "nothing to
	// load here" screen can be opened without tearing down the seeded one.
	bareUrl: string;
	bareRepoRoot: string;
	// The seeded project's state lives under here, not in the repo, so a test
	// that starts a server of its own has to point it at the same directory.
	globalDir: string;
};
