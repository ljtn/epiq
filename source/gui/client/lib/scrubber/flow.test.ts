import {describe, expect, it} from 'vitest';
import {GuiEventTimeline, GuiEventTimelineEntry} from '../gui-state.model';
import {
	buildFlowChart,
	CLOSED_STRAND_ID,
	flowPathAt,
	flowStrandOf,
	flowVertexAt,
} from './flow';
import {flowGeometry, flowLineY, flowStrandCentre} from './layout';

const LANES = [
	{id: 'backlog', title: 'Backlog'},
	{id: 'ongoing', title: 'Ongoing'},
	{id: 'done', title: 'Done'},
];
const CLOSED_LANE = 'closed-lane';
const TITLES = new Map([
	...LANES.map(lane => [lane.id, lane.title] as const),
	['elsewhere', 'Elsewhere'],
]);

const entry = (
	t: number,
	action: string,
	issue: string,
	lane: string | null,
	laneBefore: string | null = null,
	extra: Partial<GuiEventTimelineEntry> = {},
): GuiEventTimelineEntry => ({
	id: `${issue}-${action}-${t}`,
	t,
	action,
	label: action,
	actor: null,
	tag: null,
	assignee: null,
	issue,
	board: null,
	lane,
	laneBefore,
	...extra,
});

const window = (
	events: GuiEventTimelineEntry[],
	earliest = 0,
	latest = 100,
	lanesAtStart: Record<string, string> = {},
	laneNames: Record<string, string> = {},
): GuiEventTimeline => ({
	bucketMs: 1,
	capped: false,
	buckets: [],
	events,
	lanesAtStart,
	laneNames,
	closedLane: CLOSED_LANE,
	earliest,
	latest,
});

const chart = (events: GuiEventTimelineEntry[], bounds?: [number, number]) =>
	buildFlowChart(window(events, ...(bounds ?? [])), LANES, TITLES);

describe('buildFlowChart', () => {
	it('lists the board lanes in order, with the closed strand last', () => {
		expect(chart([]).strands.map(s => s.id)).toEqual([
			...LANES.map(l => l.id),
			CLOSED_STRAND_ID,
		]);
	});

	it('draws nothing from a capped window', () => {
		expect(
			buildFlowChart(
				{
					bucketMs: 1,
					capped: false,
					buckets: [{t: 0, count: 5}],
					events: [],
					lanesAtStart: {},
					laneNames: {},
					closedLane: 'closed-lane',
					earliest: 0,
					latest: 100,
				},
				LANES,
				TITLES,
			).paths,
		).toEqual([]);
	});

	it('starts a ticket born in the window at its creation, on its lane', () => {
		const {paths} = chart([entry(10, 'add.issue', 'a', 'backlog')]);

		expect(paths).toEqual([
			{
				issue: 'a',
				color: null,
				closed: false,
				vertices: [
					{t: 10, strand: 0, slot: 0, eventId: 'a-add.issue-10'},
					{t: 100, strand: 0, slot: 0, eventId: null},
				],
			},
		]);
	});

	it('steps to the lane a move went to, at the move', () => {
		const {paths} = chart([
			entry(10, 'add.issue', 'a', 'backlog'),
			entry(40, 'move.node', 'a', 'ongoing', 'backlog'),
			entry(70, 'move.node', 'a', 'done', 'ongoing'),
		]);

		expect(paths[0]!.vertices.map(v => [v.t, v.strand])).toEqual([
			[10, 0],
			[40, 1],
			[70, 2],
			[100, 2],
		]);
	});

	it('treats a move inside a lane as no step', () => {
		const {paths} = chart([
			entry(10, 'add.issue', 'a', 'backlog'),
			entry(40, 'move.node', 'a', 'backlog'),
		]);

		expect(paths[0]!.vertices.map(v => v.t)).toEqual([10, 100]);
	});

	it('runs a ticket alive at the start from the edge, on the lane it left', () => {
		const {paths} = chart([entry(40, 'move.node', 'a', 'ongoing', 'backlog')]);

		expect(paths[0]!.vertices.map(v => [v.t, v.strand, v.eventId])).toEqual([
			[0, 0, null],
			[40, 1, 'a-move.node-40'],
			[100, 1, null],
		]);
	});

	it('places a ticket that never moved by the lane its events carry', () => {
		const {paths} = chart([entry(40, 'add.issue.comment', 'a', 'ongoing')]);

		expect(paths[0]!.vertices.map(v => [v.t, v.strand])).toEqual([
			[0, 1],
			[100, 1],
		]);
	});

	it('ends a closed ticket at its close, on the closed strand', () => {
		const {strands, paths} = chart([
			entry(10, 'add.issue', 'a', 'ongoing'),
			entry(60, 'close.issue', 'a', CLOSED_LANE, 'ongoing'),
		]);

		expect(paths[0]!.closed).toBe(true);
		expect(paths[0]!.vertices.map(v => [v.t, v.strand])).toEqual([
			[10, 1],
			[60, strands.length - 1],
		]);
	});

	it('brings a reopened ticket back out of the closed strand', () => {
		const {strands, paths} = chart([
			entry(10, 'close.issue', 'a', CLOSED_LANE, 'done'),
			entry(50, 'reopen.issue', 'a', 'backlog', CLOSED_LANE),
		]);

		const closed = strands.length - 1;
		expect(paths[0]!.closed).toBe(false);
		expect(paths[0]!.vertices.map(v => [v.t, v.strand])).toEqual([
			[0, 2],
			[10, closed],
			[50, 0],
			[100, 0],
		]);
	});

	it('adds a strand, before the closed one, for a lane the board does not hold', () => {
		const {strands, paths} = chart([
			entry(10, 'add.issue', 'a', 'elsewhere'),
			entry(20, 'add.issue', 'b', 'gone'),
		]);

		expect(strands.map(s => s.title)).toEqual([
			'Backlog',
			'Ongoing',
			'Done',
			'Elsewhere',
			'(removed lane)',
			'Closed',
		]);
		expect(paths.map(p => p.vertices[0]!.strand)).toEqual([3, 4]);
	});

	it('draws a ticket when any of its events passes the view, with all its moves', () => {
		const events = [
			entry(10, 'add.issue', 'a', 'backlog'),
			entry(40, 'move.node', 'a', 'ongoing', 'backlog'),
			entry(50, 'add.issue.comment', 'a', 'ongoing'),
			entry(10, 'add.issue', 'b', 'backlog'),
		];

		const {paths} = buildFlowChart(window(events), LANES, TITLES, 'comments');

		expect(paths.map(p => p.issue)).toEqual(['a']);
		expect(paths[0]!.vertices.map(v => v.strand)).toEqual([0, 1, 1]);
	});

	it('keeps only the narrowed tickets', () => {
		const {paths} = buildFlowChart(
			window([
				entry(10, 'add.issue', 'a', 'backlog'),
				entry(10, 'add.issue', 'b', 'backlog'),
			]),
			LANES,
			TITLES,
			'all',
			new Set(),
			new Set(['b']),
		);

		expect(paths.map(p => p.issue)).toEqual(['b']);
	});

	// The strata are the window's, so narrowing the tickets does not move the
	// lines that remain.
	it('keeps a strand for a lane only a narrowed-out ticket names', () => {
		const {strands, paths} = buildFlowChart(
			window([
				entry(10, 'add.issue', 'a', 'backlog'),
				entry(10, 'add.issue', 'b', 'elsewhere'),
			]),
			LANES,
			TITLES,
			'all',
			new Set(),
			new Set(['a']),
		);

		expect(strands.map(s => s.title)).toContain('Elsewhere');
		expect(paths.map(p => p.issue)).toEqual(['a']);
	});

	// Lines sharing a strand at one time take slots of their own, so they
	// stack inside its band rather than drawing over one another.
	it('stacks lines that share a strand, and reuses a slot once it is free', () => {
		const {strands, paths} = chart([
			entry(10, 'add.issue', 'a', 'backlog'),
			entry(20, 'add.issue', 'b', 'backlog'),
			entry(30, 'move.node', 'a', 'ongoing', 'backlog'),
			entry(40, 'add.issue', 'c', 'backlog'),
		]);

		const slotsOf = (issue: string) =>
			paths.find(p => p.issue === issue)!.vertices.map(v => v.slot);

		// Backlog, then Ongoing, then the window's end: each a stay of its own.
		expect(slotsOf('a')).toEqual([0, 0, 0]);
		expect(slotsOf('b')).toEqual([1, 1]);
		// a left backlog at 30, so c takes its slot at 40.
		expect(slotsOf('c')).toEqual([0, 0]);
		expect(strands.map(s => s.slots)).toEqual([2, 1, 0, 0]);
	});

	it('colours a line by its ticket, where the board gives it one', () => {
		const {paths} = buildFlowChart(
			window([
				entry(10, 'add.issue', 'a', 'backlog'),
				entry(10, 'add.issue', 'b', 'backlog'),
			]),
			LANES,
			TITLES,
			'all',
			new Set(),
			null,
			new Map([['a', '#abc']]),
		);

		expect(paths.map(p => [p.issue, p.color])).toEqual([
			['a', '#abc'],
			['b', null],
		]);
	});

	// A quiet window: nothing happened, but the tickets were there. Zoomed in
	// on a minute with no moves, the lines still run across.
	it('runs a line across the window for a ticket open at its start with no event in it', () => {
		const {paths} = buildFlowChart(
			window([], 0, 100, {a: 'ongoing'}),
			LANES,
			TITLES,
		);

		expect(paths).toEqual([
			{
				issue: 'a',
				color: null,
				closed: false,
				vertices: [
					{t: 0, strand: 1, slot: 0, eventId: null},
					{t: 100, strand: 1, slot: 0, eventId: null},
				],
			},
		]);
	});

	it('starts an open ticket on the lane it sat in, and steps from there', () => {
		const {paths} = buildFlowChart(
			window([entry(40, 'move.node', 'a', 'done', 'ongoing')], 0, 100, {
				a: 'ongoing',
			}),
			LANES,
			TITLES,
		);

		expect(paths[0]!.vertices.map(v => [v.t, v.strand])).toEqual([
			[0, 1],
			[40, 2],
			[100, 2],
		]);
	});

	it('draws a quiet ticket under the plain view only, and only where kept', () => {
		const quiet = window([], 0, 100, {a: 'ongoing', b: 'done'});

		expect(buildFlowChart(quiet, LANES, TITLES, 'comments').paths).toEqual([]);
		expect(
			buildFlowChart(
				quiet,
				LANES,
				TITLES,
				'all',
				new Set(),
				new Set(['b']),
			).paths.map(p => p.issue),
		).toEqual(['b']);
	});

	it('gives a strand to a lane only a quiet ticket sits in', () => {
		const {strands} = buildFlowChart(
			window([], 0, 100, {a: 'elsewhere'}),
			LANES,
			TITLES,
		);

		expect(strands.map(s => s.title)).toContain('Elsewhere');
	});

	it('names a removed lane by its last known name', () => {
		const {strands} = buildFlowChart(
			window(
				[entry(10, 'add.issue', 'a', 'gone')],
				0,
				100,
				{},
				{
					gone: 'Ideas',
				},
			),
			LANES,
			TITLES,
		);

		expect(strands.map(s => s.title)).toContain('Ideas (removed lane)');
	});

	it('skips a ticket whose events name no lane', () => {
		expect(chart([entry(10, 'add.issue.comment', 'a', null)]).paths).toEqual(
			[],
		);
	});
});

describe('flowStrandOf', () => {
	const path = chart([
		entry(10, 'add.issue', 'a', 'backlog'),
		entry(40, 'move.node', 'a', 'ongoing', 'backlog'),
	]).paths[0]!;

	it('answers the strand the line is on at a moment', () => {
		expect(flowStrandOf(path, 20)).toBe(0);
		expect(flowStrandOf(path, 40)).toBe(1);
		expect(flowStrandOf(path, 90)).toBe(1);
	});

	it('answers null off either end of the line', () => {
		expect(flowStrandOf(path, 5)).toBeNull();
		expect(flowStrandOf(path, 101)).toBeNull();
	});
});

describe('flowVertexAt', () => {
	const path = chart([
		entry(10, 'add.issue', 'a', 'backlog'),
		entry(40, 'move.node', 'a', 'ongoing', 'backlog'),
	]).paths[0]!;

	it('answers the vertex whose stay covers the moment', () => {
		expect(flowVertexAt(path, 20)?.eventId).toBe('a-add.issue-10');
		expect(flowVertexAt(path, 40)?.eventId).toBe('a-move.node-40');
		expect(flowVertexAt(path, 5)).toBeNull();
	});
});

describe('flowPathAt', () => {
	const {paths} = chart([
		entry(10, 'add.issue', 'a', 'backlog'),
		entry(10, 'add.issue', 'b', 'done'),
	]);
	const lineY = (vertex: {strand: number}) => vertex.strand * 10;

	it('picks the nearest line within tolerance', () => {
		expect(flowPathAt(paths, 50, 3, lineY, 4)?.issue).toBe('a');
		expect(flowPathAt(paths, 50, 18, lineY, 4)?.issue).toBe('b');
	});

	it('picks nothing past the tolerance, or off the lines', () => {
		expect(flowPathAt(paths, 50, 10, lineY, 4)).toBeNull();
		expect(flowPathAt(paths, 5, 0, lineY, 4)).toBeNull();
	});
});

describe('flowGeometry', () => {
	it('gives a busy strand a taller band, and keeps a quiet one at the minimum', () => {
		const geometry = flowGeometry([{slots: 0}, {slots: 12}, {slots: 40}]);

		expect(geometry.heights[0]).toBe(14);
		expect(geometry.heights[1]).toBe(30);
		// Capped: the slots close up instead.
		expect(geometry.heights[2]).toBe(32);
		expect(geometry.tops).toEqual([10, 24, 54]);
		expect(geometry.height).toBe(86);
	});

	it('spreads a short board over the other modes’ height', () => {
		const geometry = flowGeometry([{slots: 1}, {slots: 1}]);

		expect(geometry.height).toBe(56);
		expect(geometry.heights).toEqual([23, 23]);
	});

	it('fans a strand’s slots about its centre, two pixels apart', () => {
		const geometry = flowGeometry([{slots: 3}, {slots: 3}, {slots: 3}]);
		const centre = flowStrandCentre(geometry, 1);

		expect(flowLineY(geometry, 1, 0, 3)).toBe(centre - 2);
		expect(flowLineY(geometry, 1, 1, 3)).toBe(centre);
		expect(flowLineY(geometry, 1, 2, 3)).toBe(centre + 2);
	});

	it('closes the slots up where the band is full', () => {
		const geometry = flowGeometry([{slots: 40}, {slots: 40}, {slots: 40}]);
		const spacing =
			flowLineY(geometry, 0, 1, 40) - flowLineY(geometry, 0, 0, 40);

		expect(spacing).toBeLessThan(2);
		expect(spacing).toBeGreaterThan(0);
	});
});
