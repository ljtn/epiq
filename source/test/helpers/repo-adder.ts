// One of several processes connecting repos to one board at the same moment,
// each as its own actor.
// argv: <board> <name> <count> <start at, epoch ms>
import {ulid} from 'ulid';
import {writeRepoEvents} from './repo-events.js';

const [board = '', name = '', count = '0', startAt = '0'] =
	process.argv.slice(2);
const actor = ulid();

while (Date.now() < Number(startAt)) {
	// Spun, not slept: every adder leaves the line in the same millisecond.
}

const refused: string[] = [];
for (let index = 0; index < Number(count); index++) {
	try {
		writeRepoEvents(
			board,
			[
				{
					action: 'connect.repo',
					payload: {url: `https://example.com/${name}-${index}.git`},
				},
			],
			actor,
		);
	} catch (error) {
		refused.push(String(error));
	}
}

process.stdout.write(JSON.stringify({refused}));
