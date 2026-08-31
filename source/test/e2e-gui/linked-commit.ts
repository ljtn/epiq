import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The seeded repo has no code history: link one commit to a ticket by
// prefixing its subject with the ref shown in the panel. The server caches the
// commit timeline for this long, so a page that already asked once has to
// outlive it before a reload sees the commit.
export const COMMIT_CACHE_MS = 5_500;

/**
 * Every worker's tests share one seeded repo, so a fixed path collides: two
 * files committing the same contents leave nothing to stage and `git commit`
 * exits non-zero, and two committing different contents make the second a
 * modification rather than the addition its diff stat is asserted to be. The
 * ref is a fresh ticket's, so it is unique per call — including across a
 * retry, which re-runs against the same repo.
 */
export const linkedFileName = (ref: string): string => `notes-${ref}.txt`;

export const commitLinkedFile = (
	repoRoot: string,
	ref: string,
	subject: string,
	fileName = linkedFileName(ref),
	contents = 'alpha\nbeta\ngamma\n',
): string => {
	fs.writeFileSync(path.join(repoRoot, fileName), contents);
	const git = (...args: string[]) =>
		execFileSync(
			'git',
			['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args],
			{cwd: repoRoot, stdio: 'pipe'},
		);
	git('add', fileName);
	git('commit', '-q', '-m', `${ref} ${subject}`);

	return git('rev-parse', 'HEAD').toString().trim();
};
