// Writes an event log the size a team actually reaches, so the rest of the
// stress run has something real to chew on.
//
// The lines are minted the way persist() mints them — `{[action]: payload, v,
// id: [ulid, refId]}`, ULIDs that climb, a refId chain per actor — and every
// payload is checked against the schema the product parses with. A log of
// plausible-looking lines that fails to apply would be worse than no test at
// all: it would look like it passed.
//
// What it writes is a board being worked, not a board being filled. Tickets are
// opened into the first lane, walked along the lanes as they are worked, and
// closed — so the open board stays the size a real one is, and the decade of
// history piles up where a decade of history actually goes: the closed board.
//
// Not a test file. Nothing runs this but `npm run stress`.

import fs from 'node:fs';
import path from 'node:path';
import {ulid} from 'ulid';
import {parseEventPayload} from '../../lib/event/event-payload.schema.js';
import {EventAction} from '../../lib/event/event.model.js';
import {CLOSED_SWIMLANE_ID} from '../../lib/event/static-ids.js';
import {isFail} from '../../lib/model/result-types.js';

export type GenerateInput = {
	stateRoot: string;
	laneIds: string[];
	actors: {userId: string; userName: string}[];
	events: number;
	years: number;
	// Which actions the log is made of. Narrowing it to one or two is how a slow
	// handler is found.
	shape?: readonly string[];
	// Created by the log itself, so replay has them before anything uses them.
	tagNames: string[];
	// How many tickets stay open. A board's open count is a steady state rather
	// than a fraction of its age: a team closes work to keep the board readable,
	// so ten years of history leaves about as many open tickets as one year.
	openTickets?: number;
};

// Roughly what a person does to a ticket, in the proportions a board sees: far
// more tagging, commenting and moving than creating.
const SHAPE = [
	'add.issue',
	'add.issue.tag',
	'add.issue.comment',
	'add.issue.comment',
	'move.node',
	'move.node',
	'edit.title',
	'edit.description',
	'add.issue.assignee',
	'close.issue',
] as const;

type Action = (typeof SHAPE)[number];

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Distinct and climbing, the way rankBetween mints them.
//
// A handful of values cycled instead put hundreds of thousands of tickets on
// six ranks, and a lane of duplicates is not what a board holds — it is what
// sends every later write into a rebalance, so the fixture reported a write
// cost the product does not actually have.
//
// Fixed width so the string order is the numeric one, and in steps rather than
// singles so there is room to insert between two without rebalancing.
const rankAt = (n: number): string => String(n * 100).padStart(12, '0');

// A ticket on the board, and how far along the lanes it has been worked.
type OpenTicket = {id: string; lane: number};

export const generateLog = async (
	input: GenerateInput,
): Promise<{lines: number; closed: number; open: number}> => {
	const eventsDir = path.join(input.stateRoot, '.epiq', 'events');
	fs.mkdirSync(eventsDir, {recursive: true});

	// One open handle per actor: a million appends through writeFileSync would
	// be a million opens.
	const streams = input.actors.map(actor => ({
		actor,
		out: fs.createWriteStream(
			path.join(eventsDir, `${actor.userId}.${actor.userName}.jsonl`),
			{flags: 'a'},
		),
		buffer: [] as string[],
	}));

	const shape = (input.shape ?? SHAPE) as readonly Action[];
	const openTarget = input.openTickets ?? 250;

	const start = Date.now() - input.years * YEAR_MS;
	const step = Math.max(1, Math.floor((input.years * YEAR_MS) / input.events));

	// The tail of the causal order, which is what an actor refs when it has
	// synced. Advanced globally rather than per actor, the way a team that syncs
	// often really looks.
	let edge: string | null = null;

	// A minority of events ref an older edge instead: concurrent work, which is
	// what makes getSortedEvents do more than walk a list.
	let staleEdge: string | null = null;

	// Checked against the schema the product parses with, not against what this
	// file believes. A payload missing a field materializes anyway — nothing
	// validates one on load — and surfaces far later as a crash somewhere else
	// entirely: a comment with no author took the GUI down inside colour
	// generation, long after the mistake was written.
	//
	// Once per distinct action: the schema is the same for every event of a
	// kind, and a million parses would cost more than the generation.
	const validated = new Set<string>();

	const validate = (action: string, payload: Record<string, unknown>) => {
		if (validated.has(action)) return;
		validated.add(action);

		const result = parseEventPayload(action as EventAction, payload);

		if (isFail(result)) {
			throw new Error(`generated an invalid ${action}: ${result.message}`);
		}
	};

	let written = 0;
	let closed = 0;

	const write = (
		action: string,
		payload: Record<string, unknown>,
		id: string,
		refId: string | null,
	) => {
		const stream = streams[written % streams.length]!;

		validate(action, payload);
		stream.buffer.push(
			JSON.stringify({[action]: payload, v: 1, id: [id, refId]}),
		);

		if (stream.buffer.length >= 4096) {
			stream.out.write(stream.buffer.join('\n') + '\n');
			stream.buffer.length = 0;
		}

		staleEdge = edge;
		edge = id;
		written++;
	};

	// The log makes what it later refers to. Borrowing the seed project's ids
	// left every tagging and every assignment skipped on replay — a third of the
	// events silently not becoming board state, which measures a smaller board
	// and calls it a pass.
	//
	// Strictly before the first event that uses them, so no reordering of
	// concurrent branches can put a tagging ahead of its tag.
	let preambleAt = start - (input.actors.length + input.tagNames.length);

	const tagIds = input.tagNames.map((_, index) =>
		ulid(start - input.tagNames.length + index),
	);

	for (const actor of input.actors) {
		write(
			'create.contributor',
			{id: actor.userId, name: actor.userName},
			ulid(preambleAt++),
			edge,
		);
	}

	input.tagNames.forEach((name, index) => {
		write('create.tag', {id: tagIds[index]!, name}, ulid(preambleAt++), edge);
	});

	// The tickets on the board, oldest first.
	const open: OpenTicket[] = [];

	for (let i = 0; i < input.events; i++) {
		const shaped = shape[i % shape.length]!;

		// Closing is what holds the open board at its size. Below the target a
		// team has nothing it would be closing, so the event becomes work on a
		// ticket instead — which also stops the pool emptying and later events
		// naming tickets that are not there.
		// A comment rather than another tagging: the same ticket tagged with the
		// same tag twice is a skip on replay, and standing in with one would
		// manufacture thousands of them.
		const action: Action =
			shaped === 'close.issue' && open.length <= openTarget
				? 'add.issue.comment'
				: shaped;

		// Some events ref an older edge: concurrent work, which is what makes
		// getSortedEvents do more than walk a list. Never the first, though —
		// branching off the preamble makes this event a sibling of the last
		// create.tag, and siblings sort by ULID, so its whole subtree would be
		// walked before the tags it uses exist.
		const refId = i > 0 && i % 17 === 0 && staleEdge ? staleEdge : edge;

		const id = ulid(start + i * step);
		const actorId = streams[written % streams.length]!.actor.userId;

		if (action === 'add.issue') {
			const ticket: OpenTicket = {id, lane: 0};
			open.push(ticket);

			write(
				action,
				{
					id: ticket.id,
					name: `Ticket ${i}: something a person actually wrote down`,
					// Filed into the first lane, rather than dropped wherever.
					parent: input.laneIds[0]!,
					rank: rankAt(i),
				},
				id,
				refId,
			);

			continue;
		}

		if (open.length === 0) continue;

		// Closing takes the oldest: a backlog drains from the far end.
		const ticket = action === 'close.issue' ? open[0]! : open[i % open.length]!;

		if (action === 'close.issue') {
			open.shift();
			closed++;

			write(
				action,
				{
					id: ticket.id,
					// The handler refuses any parent but this one.
					parent: CLOSED_SWIMLANE_ID,
					rank: rankAt(i),
				},
				id,
				refId,
			);

			continue;
		}

		if (action === 'move.node') {
			// Along the lanes, not between random ones: a ticket is worked from
			// one column to the next, and now and then sent back one, which is
			// what a review that failed looks like.
			const back = i % 9 === 0 && ticket.lane > 0;

			ticket.lane = back
				? ticket.lane - 1
				: Math.min(ticket.lane + 1, input.laneIds.length - 1);

			write(
				action,
				{
					id: ticket.id,
					parent: input.laneIds[ticket.lane]!,
					rank: rankAt(i),
				},
				id,
				refId,
			);

			continue;
		}

		write(
			action,
			workPayload(action, ticket.id, i, actorId, tagIds),
			id,
			refId,
		);
	}

	// Awaited, not merely ended: `end()` returns before the bytes reach the disk,
	// and reading the log a moment later then finds a file that is empty or half
	// written — which measures an empty board and calls it a pass.
	await Promise.all(
		streams.map(
			stream =>
				new Promise<void>((resolve, reject) => {
					stream.out.once('finish', resolve);
					stream.out.once('error', reject);

					if (stream.buffer.length > 0) {
						stream.out.write(stream.buffer.join('\n') + '\n');
					}

					stream.out.end();
				}),
		),
	);

	return {lines: written, closed, open: open.length};
};

// Everything that happens to a ticket without moving or closing it.
const workPayload = (
	action: Action,
	issueId: string,
	n: number,
	actorId: string,
	tagIds: string[],
): Record<string, unknown> => {
	switch (action) {
		case 'add.issue.tag':
			return {id: issueId, tag: tagIds[n % tagIds.length]!};
		case 'add.issue.comment':
			return {
				id: ulid(),
				issue: issueId,
				// Required. Without it the event still materializes — nothing
				// validates a payload on load — and takes the GUI down on the first
				// read, inside colour generation, a long way from the mistake.
				author: actorId,
				md: `Had a look at this — the part to watch is the ${
					n % 7 === 0 ? 'window derivation' : 'ordering'
				}.`,
			};
		case 'edit.title':
			return {id: issueId, name: `Ticket ${n}, renamed`};
		case 'edit.description':
			return {
				id: issueId,
				md: `Longer body for ticket ${n}.\n\nSecond paragraph.`,
			};
		case 'add.issue.assignee':
			return {id: issueId, assignee: actorId};
		default:
			throw new Error(`no payload for ${action}`);
	}
};
