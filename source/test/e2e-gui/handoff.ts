import os from 'node:os';
import path from 'node:path';

// Written by serve.ts, read by the Playwright fixture. A file rather than an
// env var because the server runs as a separate process from the test workers.
export const HANDOFF_PATH = path.join(os.tmpdir(), 'epiq-gui-e2e-handoff.json');

export type Handoff = {baseUrl: string; repoRoot: string};
