// Starts git on behalf of a clone against a server that never answers, then
// waits to be signalled.
import {execGit} from '../../git/git-utils.js';

const [port, cwd] = process.argv.slice(2);

void execGit({
	cwd: cwd!,
	forClone: true,
	timeoutMs: 60_000,
	args: ['ls-remote', `git://127.0.0.1:${port}/never.git`],
});

setInterval(() => {}, 1_000);
