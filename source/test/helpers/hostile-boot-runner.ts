/**
 * Boots a board from argv[2]'s state-branch root in its own process, since a
 * throw or endless walk would take the test runner down. Prints one JSON line.
 */
import {bootStateFromEventLog} from '../../lib/board/board-boot.js';
import {loadMergedEventsWithUnreadable} from '../../lib/board/board-log.js';
import {isFail} from '../../lib/model/result-types.js';
import {getSafeState} from '../../lib/state/state.js';

const report = (value: unknown) => {
	process.stdout.write(JSON.stringify(value) + '\n');
};

const root = process.argv[2] ?? '';

try {
	const loaded = loadMergedEventsWithUnreadable(root);

	if (isFail(loaded)) {
		report({outcome: 'load-failed', message: loaded.message});
		process.exit(0);
	}

	const booted = bootStateFromEventLog(
		loaded.value.events,
		loaded.value.unreadable,
	);

	const state = getSafeState();

	report({
		outcome: isFail(booted) ? 'boot-failed' : 'booted',
		message: booted.message,
		unreadable: loaded.value.unreadable.map(entry => entry.reason),
		titles: isFail(state)
			? []
			: Object.values(state.value.nodes)
					.filter(node => !node.isDeleted)
					.map(node => node.title)
					.sort(),
	});
} catch (error) {
	report({
		outcome: 'threw',
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? (error.stack ?? '').slice(0, 600) : '',
	});
}

process.exit(0);
