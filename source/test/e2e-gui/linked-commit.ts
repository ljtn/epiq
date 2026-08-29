import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The seeded repo has no code history: link one commit to a ticket by
// prefixing its subject with the ref shown in the panel. The server caches the
// commit timeline for this long, so a page that already asked once has to
// outlive it before a reload sees the commit.
export const COMMIT_CACHE_MS = 5_500;

export const commitLinkedFile = (
	repoRoot: string,
	ref: string,
	subject: string,
	fileName = 'notes.txt',
	contents = 'alpha\nbeta\ngamma\n',
) => {
	fs.writeFileSync(path.join(repoRoot, fileName), contents);
	const git = (...args: string[]) =>
		execFileSync(
			'git',
			['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args],
			{cwd: repoRoot, stdio: 'pipe'},
		);
	git('add', fileName);
	git('commit', '-q', '-m', `${ref} ${subject}`);
};
