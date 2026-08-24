import {describe, expect, it} from 'vitest';
import {createDefaultEvents} from '../lib/event/event-boot.js';
import {materializeAll} from '../lib/event/event-materialize.js';
import {isFail} from '../lib/model/result-types.js';
import {getSafeState} from '../lib/state/state.js';

// Deliberately its own file: `init` runs against a process that has never
// initialized state, and every other event suite seeds a workspace in
// `beforeEach`, which hides ordering bugs in the default events.
describe('init default events', () => {
	it('materializes from a cold state and registers the author', () => {
		const events = createDefaultEvents({userId: 'U1', userName: 'Jo'});
		if (isFail(events)) throw new Error(events.message);

		const failures = materializeAll(events.value).filter(isFail);
		expect(failures.map(failure => failure.message)).toEqual([]);

		const state = getSafeState();
		if (isFail(state)) throw new Error(state.message);

		expect(state.value.contributors['U1']).toEqual({id: 'U1', name: 'Jo'});
	});
});
