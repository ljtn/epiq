import {describe, expect, it} from 'vitest';
import {
	parsePersistedEnvelope,
	parsePersistedEnvelopeStrict,
} from '../lib/event/event-envelope.js';
import {isFail} from '../lib/model/result-types.js';

// `parsePersistedEnvelope` is the hand-written twin of
// `PersistedEnvelopeSchema`: the schema stays as the place the shape is
// written down, and the load path reads the two fields itself rather than
// paying zod's loose-object copy of every payload on every event.
//
// So what has to hold is that the two agree. They are compared here on
// acceptance, not on the message — a hand-written check has no reason to
// reproduce zod's wording — plus the one behaviour the fast path adds: it
// hands back the value it was given rather than a copy of it.

const accepts = (
	parse: typeof parsePersistedEnvelope,
	value: unknown,
): boolean => !isFail(parse(value));

const CASES: Array<[string, unknown]> = [
	['a well-formed envelope', {v: 1, id: ['A', null]}],
	['one with a parent', {v: 1, id: ['B', 'A']}],
	['one carrying a payload', {v: 1, id: ['A', null], 'add.issue': {id: 'X'}}],
	['a version this build cannot read', {v: 99, id: ['A', null]}],

	['null', null],
	['undefined', undefined],
	['a string', '{"v":1}'],
	['a number', 7],
	['an array', [{v: 1, id: ['A', null]}]],
	['no envelope at all', {}],

	['a missing version', {id: ['A', null]}],
	['a version of zero', {v: 0, id: ['A', null]}],
	['a negative version', {v: -1, id: ['A', null]}],
	['a fractional version', {v: 1.5, id: ['A', null]}],
	['a version as a string', {v: '1', id: ['A', null]}],
	['a version as null', {v: null, id: ['A', null]}],

	['a missing id', {v: 1}],
	['an id that is not an array', {v: 1, id: 'A'}],
	['an id of one', {v: 1, id: ['A']}],
	['an id of three', {v: 1, id: ['A', null, 'C']}],
	['an empty id', {v: 1, id: ['', null]}],
	['an empty parent', {v: 1, id: ['A', '']}],
	['a numeric id', {v: 1, id: [1, null]}],
	['a numeric parent', {v: 1, id: ['A', 2]}],
	['an undefined parent', {v: 1, id: ['A', undefined]}],
	['an object as the parent', {v: 1, id: ['A', {}]}],
];

describe('parsePersistedEnvelope', () => {
	for (const [name, value] of CASES) {
		it(`agrees with the schema about ${name}`, () => {
			expect(accepts(parsePersistedEnvelope, value)).toBe(
				accepts(parsePersistedEnvelopeStrict, value),
			);
		});
	}

	// The reason it exists: the caller spreads the result and reads the payload
	// off it, and a copy of every payload on every event was 20 % of a load.
	it('hands back the line itself rather than a copy of it', () => {
		const line = {v: 1, id: ['A', null], 'add.issue': {id: 'X'}};

		const result = parsePersistedEnvelope(line);
		if (isFail(result)) throw new Error(result.message);

		expect(result.value).toBe(line);
	});

	// The envelope has to parse even when the payload does not, or an event
	// from a newer build loses its place in the causal chain.
	it('reads an envelope whose payload it knows nothing about', () => {
		const result = parsePersistedEnvelope({
			v: 1,
			id: ['B', 'A'],
			'invent.something': {shape: 'unknown', to: ['this', 'build']},
		});

		expect(isFail(result)).toBe(false);
	});
});
