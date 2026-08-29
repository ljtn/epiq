import {describe, expect, it} from 'vitest';
import {isNonFastForward, isRemoteUnreachable} from '../git/git-utils.js';
import {useTempHome} from './helpers/git-repo.js';

useTempHome();

describe('isRemoteUnreachable', () => {
	it('matches a network that is not there', () => {
		for (const message of [
			"fatal: unable to access 'https://x.invalid/r.git/': Could not resolve host: x.invalid",
			'ssh: Could not resolve hostname x.invalid: nodename nor servname provided',
			'fatal: unable to access: Failed to connect to example.com port 443: Connection refused',
			'git ls-remote origin\nGit command timed out after 10000ms',
		]) {
			expect(isRemoteUnreachable(message)).toBe(true);
		}
	});

	// These need the user to do something, so they must stay failures.
	it('does not match a rejection the user has to act on', () => {
		for (const message of [
			'git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.',
			' ! [remote rejected] HEAD -> main (pre-receive hook declined)',
			"fatal: '/tmp/gone' does not appear to be a git repository",
			' ! [rejected] main -> main (non-fast-forward)',
		]) {
			expect(isRemoteUnreachable(message)).toBe(false);
		}
	});
});

describe('isNonFastForward', () => {
	it('matches a rejection a rebase-and-retry can clear', () => {
		expect(
			isNonFastForward(
				' ! [rejected]        main -> main (fetch first)\n' +
					"error: failed to push some refs to 'origin'\n",
			),
		).toBe(true);

		expect(
			isNonFastForward(
				' ! [rejected]        main -> main (non-fast-forward)\n' +
					"error: failed to push some refs to 'origin'\n",
			),
		).toBe(true);
	});

	// Retrying would rewrite history for a rejection no rebase can clear.
	it('does not match a hook decline', () => {
		expect(
			isNonFastForward(
				'remote: policy: pushes to this branch are not allowed\n' +
					' ! [remote rejected] HEAD -> main (pre-receive hook declined)\n' +
					"error: failed to push some refs to 'origin'\n",
			),
		).toBe(false);
	});
});
