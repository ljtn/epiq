import {describe, expect, it} from 'vitest';
import {
	ALL_LOG_FIELDS,
	LOG_FIELD_ORDER,
	logFieldOffClass,
	logPaneClassName,
} from './log-fields';

describe('logPaneClassName', () => {
	// The default is every field on, so the pane has nothing to say.
	it('is empty while every field is shown', () => {
		expect(logPaneClassName(ALL_LOG_FIELDS)).toBe('');
	});

	it('names each field that is off, in row order', () => {
		expect(
			logPaneClassName({...ALL_LOG_FIELDS, kind: false, time: false}),
		).toBe(`${logFieldOffClass('time')} ${logFieldOffClass('kind')}`);
	});

	it('covers every field', () => {
		const none = Object.fromEntries(
			LOG_FIELD_ORDER.map(field => [field, false]),
		) as typeof ALL_LOG_FIELDS;

		expect(logPaneClassName(none).split(' ')).toEqual(
			LOG_FIELD_ORDER.map(logFieldOffClass),
		);
	});
});
