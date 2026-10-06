// One of several processes contending for one lock file: takes it, checks it
// is alone while it holds it, lets go, many times over. Prints how many times
// it found somebody else inside.
import fs from 'node:fs';
import {acquireLockFile} from '../../git/sync-lock.js';

const [lockPath, insidePath, rounds] = process.argv.slice(2);

let acquired = 0;
let overlaps = 0;

// Until it has held the lock that many times, or a deadline passes.
const deadline = Date.now() + 30_000;

while (acquired < Number(rounds) && Date.now() < deadline) {
	const lock = acquireLockFile({lockPath: lockPath!, operation: 'stress'});
	if (!lock.acquired) continue;

	acquired++;
	try {
		// Exclusive create: it fails only if another holder is inside too.
		const fd = fs.openSync(insidePath!, 'wx');
		const until = Date.now() + Math.random() * 2;
		while (Date.now() < until) {
			// Held a moment, so overlaps have a window to show in.
		}
		fs.closeSync(fd);
		fs.rmSync(insidePath!);
	} catch {
		overlaps++;
	} finally {
		lock.release();
	}
}

process.stdout.write(JSON.stringify({acquired, overlaps}));
