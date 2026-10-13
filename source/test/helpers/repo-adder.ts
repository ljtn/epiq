// One of several processes adding repos to one board at the same moment.
// argv: <board> <name> <count> <start at, epoch ms>
import {upsertCommitRepo} from '../../lib/commits/commit-repos.js';
import {isFail} from '../../lib/model/result-types.js';

const [board = '', name = '', count = '0', startAt = '0'] =
	process.argv.slice(2);

while (Date.now() < Number(startAt)) {
	// Spun, not slept: every adder leaves the line in the same millisecond.
}

const refused: string[] = [];
for (let index = 0; index < Number(count); index++) {
	const result = upsertCommitRepo({
		repoRoot: board,
		url: `https://example.com/${name}-${index}.git`,
	});
	if (isFail(result)) refused.push(result.message);
}

process.stdout.write(JSON.stringify({refused}));
