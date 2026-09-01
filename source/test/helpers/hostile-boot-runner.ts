/**
 * Loads and boots a board from an event directory, in a process of its own.
 *
 * Spawned rather than called: the failures this probes for are an uncaught
 * throw out of replay and a walk that never terminates, and both take the
 * process with them. A child can be killed; the test runner cannot.
 *
 * argv[2] is the state-branch root. Writes one JSON line to stdout.
 */
import {bootStateFromEventLog} from '../../lib/event/event-boot.js';
import {loadMergedEventsWithUnreadable} from '../../lib/event/event-load.js';
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
