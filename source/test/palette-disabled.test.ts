import {describe, expect, it} from 'vitest';

import {nodes} from '../lib/state/node-builder.js';

/**
 * The palette marks a command it can't run as disabled, and `palette-actions`
 * refuses to confirm it by reading `props.disabled` off the node.
 */
describe('a text node the palette marks unavailable', () => {
	const build = (disabled?: boolean) =>
		nodes.text({
			id: 'node',
			name: ':sync',
			parentNodeId: 'parent',
			rank: '000001',
			...(disabled === undefined ? {} : {disabled}),
		});

	it('carries the flag the confirm guard reads', () => {
		expect(build(true).props.disabled).toBe(true);
	});

	it('carries nothing when it is available', () => {
		expect(build(false).props.disabled).toBeUndefined();
		expect(build().props.disabled).toBeUndefined();
	});

	// The autocomplete corpus takes only string `value`s, so a text node adds no words.
	it('carries no text for the autocomplete corpus to pick up', () => {
		expect(
			Object.values(build(true).props).some(value => typeof value === 'string'),
		).toBe(false);
	});
});
