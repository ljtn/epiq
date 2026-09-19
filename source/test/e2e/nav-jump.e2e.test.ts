import {beforeAll, describe, expect, it} from 'vitest';
import {commonSteps, fileIssue} from './e2e-common-steps.js';
import {
	ARROW_DOWN,
	ENTER,
	SHIFT_ARROW_DOWN,
	SHIFT_ARROW_UP,
	setupTui,
} from './e2e.helper.js';

const testTimeout = 120_000;

type Tui = ReturnType<typeof setupTui>;

// Twelve, so a jump of five lands twice with room to spare and the clamp at
// each end is a different row from the one a wrap would reach.
const ITEM_COUNT = 12;

const itemTitle = (index: number) => `Item ${String(index).padStart(2, '0')}`;

// The breadcrumb names the selected node. The highlight itself is a colour,
// which the terminal buffer does not hand back.
const selects = (title: string) => (frame: string) =>
	frame.includes(`▸ ${title}`);

const press = async (tui: Tui, keys: string, lands: string) => {
	tui.input(keys);
	await tui.waitFor(selects(lands), 10_000);
};

// The lane's rows, top to bottom. The selected row carries the cursor where
// the others carry their position — and the cursor is a different glyph once
// a move is under way, so both of its shapes are matched.
const laneOrder = (frame: string): string[] =>
	frame
		.split('\n')
		.map(row => /│\s*(?:❯|◆|\d+)\s+(Item \d\d)/.exec(row)?.[1])
		.filter((title): title is string => title !== undefined);

beforeAll(async () => {
	const tui = setupTui();

	try {
		await commonSteps.configureInitialSettings(tui, 'off');
	} finally {
		await tui.destroy();
	}
});

describe('TUI navigation jump e2e', () => {
	it(
		'jumps five rows on shift and stops at each end',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.init(tui);

				tui.input(ENTER);
				// The default wait is three seconds, which the container suite
				// under load does not always make.
				await tui.waitFor('Todo (0)', 20_000);

				for (let index = 1; index <= ITEM_COUNT; index++) {
					await fileIssue(tui, itemTitle(index), index);
				}

				// The last issue filed is the selected one.
				await tui.waitFor(selects('Item 12'), 10_000);

				// A single step still wraps, which is what makes the jump's clamp
				// worth asserting rather than assuming.
				await press(tui, ARROW_DOWN, 'Item 01');

				await press(tui, SHIFT_ARROW_DOWN, 'Item 06');
				await press(tui, SHIFT_ARROW_DOWN, 'Item 11');
				// Five past the end is the end, not four from the top.
				await press(tui, SHIFT_ARROW_DOWN, 'Item 12');

				await press(tui, SHIFT_ARROW_UP, 'Item 07');
				await press(tui, SHIFT_ARROW_UP, 'Item 02');
				await press(tui, SHIFT_ARROW_UP, 'Item 01');

				// The vim keys carry the same modifier.
				await press(tui, 'J', 'Item 06');
				await press(tui, 'K', 'Item 01');
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);

	it(
		'moves an item five places in one keypress',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.init(tui);

				tui.input(ENTER);
				// The default wait is three seconds, which the container suite
				// under load does not always make.
				await tui.waitFor('Todo (0)', 20_000);

				for (let index = 1; index <= 6; index++) {
					await fileIssue(tui, itemTitle(index), index);
				}

				await tui.waitFor(selects('Item 06'), 10_000);
				await press(tui, ARROW_DOWN, 'Item 01');

				const before = await tui.waitFor(
					frame => laneOrder(frame).length === 6,
					10_000,
				);
				expect(laneOrder(before)).toEqual([
					'Item 01',
					'Item 02',
					'Item 03',
					'Item 04',
					'Item 05',
					'Item 06',
				]);

				// `m` starts the move, shift+down carries it a jump, `m` commits it.
				tui.input('m');
				await tui.waitFor('Mode: move', 10_000);

				tui.input(SHIFT_ARROW_DOWN);
				await tui.waitFor(frame => laneOrder(frame)[5] === 'Item 01', 10_000);

				tui.input('m');
				await tui.waitFor('Mode: default', 10_000);

				const after = await tui.waitFor(
					frame => laneOrder(frame).length === 6,
					10_000,
				);
				expect(laneOrder(after)).toEqual([
					'Item 02',
					'Item 03',
					'Item 04',
					'Item 05',
					'Item 06',
					'Item 01',
				]);

				// The gesture ends at the edge of the lane, which is where holding
				// the key lands: a jump with nowhere left to go is a no-op, and the
				// move is still under way afterwards rather than dropped for the
				// command line. Proven by carrying on with the next jump.
				tui.input('m');
				await tui.waitFor('Mode: move', 10_000);

				tui.input(SHIFT_ARROW_DOWN);
				tui.input(SHIFT_ARROW_UP);
				await tui.waitFor(frame => laneOrder(frame)[0] === 'Item 01', 10_000);

				tui.input('m');
				await tui.waitFor('Mode: default', 10_000);

				const back = await tui.waitFor(
					frame => laneOrder(frame).length === 6,
					10_000,
				);
				expect(laneOrder(back)).toEqual([
					'Item 01',
					'Item 02',
					'Item 03',
					'Item 04',
					'Item 05',
					'Item 06',
				]);
			} finally {
				await tui.destroy();
			}
		},
		testTimeout,
	);
});
