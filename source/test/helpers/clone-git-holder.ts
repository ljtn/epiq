// Starts git for a clone against a server that never answers, then waits for a
// signal. Args: an optional git proxy; `with-signal-exit` registers Ink's handler first.
import {createRequire} from 'node:module';
import {execGit} from '../../git/git-utils.js';

const [port, cwd, listener, proxy] = process.argv.slice(2);

if (listener === 'with-signal-exit') {
	// From Ink's own entry, so its copy of signal-exit is the one found.
	const inkRequire = createRequire(
		createRequire(import.meta.url).resolve('ink'),
	);
	const signalExit = inkRequire('signal-exit') as {
		onExit?: (handler: () => void) => void;
	} & ((handler: () => void) => void);
	(signalExit.onExit ?? signalExit)(() => {});
}

void execGit({
	cwd: cwd!,
	forClone: true,
	timeoutMs: 60_000,
	args: [
		// A helper that shrugs off SIGTERM and holds the connection, as a
		// stuck one would.
		...(proxy ? ['-c', `core.gitProxy=${proxy}`] : []),
		'ls-remote',
		`git://127.0.0.1:${port}/never.git`,
	],
});

setInterval(() => {}, 1_000);
