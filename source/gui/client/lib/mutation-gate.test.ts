import {describe, expect, it} from 'vitest';
import {createMutationGate} from './mutation-gate';

describe('createMutationGate', () => {
	it('lets state through when nothing is in flight', () => {
		expect(createMutationGate().holdsState()).toBe(false);
	});

	it('holds state from the moment a mutation is sent', () => {
		const gate = createMutationGate();

		gate.sent('issues:move');

		expect(gate.holdsState()).toBe(true);
	});

	it('releases once that mutation is answered', () => {
		const gate = createMutationGate();

		gate.sent('issues:move');
		gate.received('issues:move:result');

		expect(gate.holdsState()).toBe(false);
	});

	it('keeps holding until every queued mutation is answered', () => {
		const gate = createMutationGate();

		gate.sent('issues:move');
		gate.sent('issues:move');
		gate.received('issues:move:result');

		expect(gate.holdsState()).toBe(true);

		gate.received('issues:move:result');

		expect(gate.holdsState()).toBe(false);
	});

	it('ignores reads and other non-mutating traffic', () => {
		const gate = createMutationGate();

		gate.sent('state:get');
		gate.sent('timeline:get');
		gate.sent('contributors:get');
		gate.sent('time-travel:scrub');

		expect(gate.holdsState()).toBe(false);
	});

	// A handler that fails before producing a result would otherwise leave the
	// board frozen on the last state it accepted.
	it('settles on an error, not only on a result', () => {
		const gate = createMutationGate();

		gate.sent('issues:move');
		gate.received('error');

		expect(gate.holdsState()).toBe(false);
	});

	it('never goes negative on an unmatched reply', () => {
		const gate = createMutationGate();

		gate.received('issues:move:result');
		gate.received('issues:move:result');
		gate.sent('issues:move');

		expect(gate.holdsState()).toBe(true);
	});

	it('drops replies owed on a closed socket', () => {
		const gate = createMutationGate();

		gate.sent('issues:move');
		gate.reset();

		expect(gate.holdsState()).toBe(false);
	});

	it('is unmoved by state and broadcast messages', () => {
		const gate = createMutationGate();

		gate.sent('issues:move');
		gate.received('state');
		gate.received('sync-status');
		gate.received(undefined);

		expect(gate.holdsState()).toBe(true);
	});
});
