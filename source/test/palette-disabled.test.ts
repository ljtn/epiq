import {describe, expect, it} from 'vitest';

import {nodes} from '../lib/state/node-builder.js';

/**
 * The palette draws a command it cannot run as `[unavailable]`, dimmed and
 * sorted last, and `palette-actions` refuses to confirm one by reading
 * `props.disabled` off the node.
 *
 * That flag never arrived. `nodes.text` took a free `props` bag, ignored it and
 * wrote `props: {}` — so the palette's `disabled: !command.isAvailable` was
 * dropped on the floor and the guard had nothing to read. An unavailable
 * command looked refused and ran anyway. Found by review; it predates the diff
 * viewer, which only made the dead argument visible.
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

	// The same props are swept into the command line's autocomplete corpus,
	// which takes any string `value`. A flag is not one, and nothing else is
	// carried, so a text node still contributes no words.
	it('carries no text for the autocomplete corpus to pick up', () => {
		expect(
			Object.values(build(true).props).some(value => typeof value === 'string'),
		).toBe(false);
	});
});
