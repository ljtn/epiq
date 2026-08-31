import fs from 'node:fs';
import {expect, test} from './fixtures.js';

// The endpoint a second epiq probes to decide whether to open this server or
// start its own. It has to answer before the board is touched, and name the
// project in the same canonical form the prober compares against.
test('the server names itself and its project', async ({
	request,
	appUrl,
	repoRoot,
}) => {
	const response = await request.get(`${appUrl}/api/instance`);
	expect(response.ok()).toBe(true);

	const body = await response.json();

	expect(body.app).toBe('epiq');
	expect(typeof body.version).toBe('string');
	expect(typeof body.pid).toBe('number');
	// Canonical: the fixture's path may reach the same directory by a symlink
	// (/var vs /private/var on macOS), and a prober comparing strings has to
	// still match.
	expect(body.repoRoot).toBe(fs.realpathSync(repoRoot));
});
