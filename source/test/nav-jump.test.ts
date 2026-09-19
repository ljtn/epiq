import {beforeEach, describe, expect, it} from 'vitest';
import {
	NAV_JUMP_SIZE,
	navigationUtils,
} from '../lib/actions/default/navigation-action-utils.js';
import {Mode} from '../lib/model/action-map.model.js';
import {AnyContext} from '../lib/model/context.model.js';
import {NavNode} from '../lib/model/navigation-node.model.js';
import {nodes as build} from '../lib/state/node-builder.js';
import {getState, initWorkspaceState, patchState} from '../lib/state/state.js';
import {getKeyIntent, Intent} from '../lib/utils/key-intent.js';

const key = (
	name: string,
	modifiers: {shift?: boolean; ctrl?: boolean; meta?: boolean} = {},
) => ({
	name,
	ctrl: modifiers.ctrl ?? false,
	meta: modifiers.meta ?? false,
	shift: modifiers.shift ?? false,
	sequence: name,
});

const rankOf = (index: number) => String.fromCharCode(97 + index);

// A lane holding `count` tickets, with the lane as the context node: the
// vertical axis, so up/down are item steps and left/right are the lane's
// siblings.
const seedLane = (count: number, selectedIndex = 0) => {
	const workspace = build.workspace('root', 'Workspace', 'a');
	const board = build.board('board', 'Board', 'root', 'a');
	const lane = build.swimlane('lane', 'Todo', 'board', 'a');
	const otherLane = build.swimlane('other', 'Doing', 'board', 'b');

	const tickets = Array.from({length: count}, (_, index) =>
		build.ticket(`t${index}`, `Item ${index}`, 'lane', rankOf(index)),
	);

	initWorkspaceState(workspace);

	patchState({
		nodes: {
			root: workspace,
			board,
			lane,
			other: otherLane,
			...Object.fromEntries(
				tickets.map(ticket => [ticket.id, ticket as NavNode<AnyContext>]),
			),
		},
		contextNodeId: 'lane',
		selectedIndex,
		mode: Mode.DEFAULT,
	});
};

describe('navigation jump', () => {
	beforeEach(() => {
		seedLane(12);
	});

	it('moves a whole jump down in one keypress', () => {
		navigationUtils.jumpToNextItem();

		expect(getState().selectedIndex).toBe(NAV_JUMP_SIZE);
	});

	it('stops at the last item instead of wrapping', () => {
		patchState({selectedIndex: 9});

		navigationUtils.jumpToNextItem();

		expect(getState().selectedIndex).toBe(11);
	});

	it('stops at the first item instead of wrapping', () => {
		patchState({selectedIndex: 2});

		navigationUtils.jumpToPreviousItem();

		expect(getState().selectedIndex).toBe(0);
	});

	it('leaves a single step wrapping as it was', () => {
		patchState({selectedIndex: 11});

		navigationUtils.navigateToNextItem();

		expect(getState().selectedIndex).toBe(0);
	});

	it('does nothing in an empty container', () => {
		seedLane(0, -1);

		navigationUtils.jumpToNextItem();

		expect(getState().selectedIndex).toBe(-1);
	});

	it('jumps from an unselected container to the first jump target', () => {
		patchState({selectedIndex: -1});

		navigationUtils.jumpToNextItem();

		expect(getState().selectedIndex).toBe(NAV_JUMP_SIZE);
	});
});

describe('jump key intents', () => {
	beforeEach(() => {
		seedLane(12);
	});

	it('reads shift+arrow as a jump along the item axis', () => {
		expect(getKeyIntent(key('down', {shift: true}), Mode.DEFAULT)).toBe(
			Intent.NavNextItemJump,
		);
		expect(getKeyIntent(key('up', {shift: true}), Mode.DEFAULT)).toBe(
			Intent.NavPreviousItemJump,
		);
	});

	it('reads shift+j and shift+k as a jump', () => {
		expect(getKeyIntent(key('j', {shift: true}), Mode.DEFAULT)).toBe(
			Intent.NavNextItemJump,
		);
		expect(getKeyIntent(key('k', {shift: true}), Mode.DEFAULT)).toBe(
			Intent.NavPreviousItemJump,
		);
	});

	it('keeps an unmodified arrow a single step', () => {
		expect(getKeyIntent(key('down'), Mode.DEFAULT)).toBe(Intent.NavNextItem);
		expect(getKeyIntent(key('j'), Mode.DEFAULT)).toBe(Intent.NavNextItem);
	});

	// Ctrl and alt are the modifiers a terminal also delivers; neither is bound,
	// so they stay single steps rather than quietly becoming jumps.
	it('ignores ctrl and alt', () => {
		expect(getKeyIntent(key('down', {ctrl: true}), Mode.DEFAULT)).toBe(
			Intent.NavNextItem,
		);
		expect(getKeyIntent(key('down', {meta: true}), Mode.DEFAULT)).toBe(
			Intent.NavNextItem,
		);
	});

	it('does not multiply a step between containers', () => {
		expect(getKeyIntent(key('right', {shift: true}), Mode.DEFAULT)).toBe(
			Intent.NavToNextContainer,
		);
		expect(getKeyIntent(key('left', {shift: true}), Mode.DEFAULT)).toBe(
			Intent.NavToPreviousContainer,
		);
	});

	it('jumps in move mode too', () => {
		expect(getKeyIntent(key('down', {shift: true}), Mode.MOVE)).toBe(
			Intent.MoveNextItemJump,
		);
		expect(getKeyIntent(key('up', {shift: true}), Mode.MOVE)).toBe(
			Intent.MovePreviousItemJump,
		);
		expect(getKeyIntent(key('right', {shift: true}), Mode.MOVE)).toBe(
			Intent.MoveToNextContainer,
		);
	});
});
