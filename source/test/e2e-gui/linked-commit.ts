import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Links a commit to a ticket by leading its subject with the ref. The test
// server caches no git scans (serve.ts).

// One identity and cwd for every commit these helpers make.
const gitIn =
	(repoRoot: string, date?: Date) =>
	(...args: string[]) =>
		execFileSync(
			'git',
			['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.com', ...args],
			{
				cwd: repoRoot,
				stdio: 'pipe',
				env: date
					? {
							...process.env,
							GIT_AUTHOR_DATE: date.toISOString(),
							GIT_COMMITTER_DATE: date.toISOString(),
					  }
					: process.env,
			},
		);

// Keyed by a fresh ref: the worker's tests share one repo.
export const linkedFileName = (ref: string): string => `notes-${ref}.txt`;

/** One commit carrying several files, keyed by name. */
export const commitLinkedFiles = (
	repoRoot: string,
	ref: string,
	subject: string,
	contentsByFileName: Record<string, string>,
): string => {
	const git = gitIn(repoRoot);

	for (const [fileName, contents] of Object.entries(contentsByFileName)) {
		fs.writeFileSync(path.join(repoRoot, fileName), contents);
		git('add', fileName);
	}

	git('commit', '-q', '-m', `${ref} ${subject}`);

	return git('rev-parse', 'HEAD').toString().trim();
};

export const commitLinkedFile = (
	repoRoot: string,
	ref: string,
	subject: string,
	fileName = linkedFileName(ref),
	contents = 'alpha\nbeta\ngamma\n',
): string => commitLinkedFiles(repoRoot, ref, subject, {[fileName]: contents});

/** A commit that names a ticket and changes no lines. */
export const commitLinkedNothing = (
	repoRoot: string,
	ref: string,
	subject: string,
): string => {
	const git = gitIn(repoRoot);

	git('commit', '-q', '--allow-empty', '-m', `${ref} ${subject}`);

	return git('rev-parse', 'HEAD').toString().trim();
};

/** A commit with no ref in its subject, unless a `body` paragraph names one. */
export const commitPlainFile = (
	repoRoot: string,
	fileName: string,
	subject: string,
	contents = 'one\ntwo\n',
	date?: Date,
	body: string[] = [],
): string => {
	const git = gitIn(repoRoot, date);

	fs.writeFileSync(path.join(repoRoot, fileName), contents);
	git('add', fileName);
	git(
		'commit',
		'-q',
		...[subject, ...body].flatMap(message => ['-m', message]),
	);

	return git('rev-parse', 'HEAD').toString().trim();
};
