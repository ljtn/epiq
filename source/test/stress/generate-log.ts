// Writes a realistic-size event log for `npm run stress`, minted as persist()
// does and schema-checked. Tickets are worked through lanes and closed.

import fs from 'node:fs';
import path from 'node:path';
import {ulid} from 'ulid';
import {parseEventPayload} from '../../lib/board/board-events.schema.js';
import {EventAction} from '../../lib/board/board-events.model.js';
import {CLOSED_SWIMLANE_ID} from '../../lib/board/static-ids.js';
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
	// Open tickets held steady, as a team keeps its board readable.
	openTickets?: number;
	// How many goals the decade's tickets are grouped under, one after another
	// as the years go by; every other ticket joins the goal of its time.
	goals?: number;
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

// Distinct, climbing, fixed-width ranks with gaps, as rankBetween mints them;
// duplicates would force rebalances.
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

	// The tail of the causal order, advanced globally, as a team that syncs often.
	let edge: string | null = null;

	// A minority of events ref an older edge instead: concurrent work, which is
	// what makes getSortedEvents do more than walk a list.
	let staleEdge: string | null = null;

	// Checked against the product's schema, since load doesn't validate. Once per
	// action.
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

	// No room for a ticket's join at a millisecond a step.
	const goalCount = step > 1 ? input.goals ?? 0 : 0;

	let preambleAt =
		start - (input.actors.length + input.tagNames.length + goalCount);

	const tagIds = input.tagNames.map((_, index) =>
		ulid(start - input.tagNames.length + index),
	);

	// The log mints the tags and contributors it uses, before their first use.
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

	const goalIds = Array.from({length: goalCount}, () => ulid(preambleAt++));
	goalIds.forEach((id, index) => {
		write('create.goal', {id, name: `Goal ${index}`}, id, edge);
	});

	// The tickets on the board, oldest first.
	const open: OpenTicket[] = [];

	for (let i = 0; i < input.events; i++) {
		const shaped = shape[i % shape.length]!;

		// Below the open target, a close becomes a comment instead (a repeat tagging
		// would be skipped on replay).
		const action: Action =
			shaped === 'close.issue' && open.length <= openTarget
				? 'add.issue.comment'
				: shaped;

		// Some events ref an older edge (concurrency), never the first: a sibling of
		// the preamble would sort before its tags.
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

			// Every other ticket, halfway to the next event, so the join sorts
			// after the ticket it names.
			if (goalCount > 0 && Math.floor(i / shape.length) % 2 === 0) {
				const goal = goalIds[Math.floor((i / input.events) * goalCount)]!;
				write(
					'add.issue.goal',
					{id: ticket.id, goal},
					ulid(start + i * step + Math.floor(step / 2)),
					edge,
				);
			}

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
			// Along the lanes, sometimes back one, like a failed review.
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

	// Awaited: `end()` returns before the bytes reach disk.
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
				// Required: load doesn't validate, and a missing one crashes the GUI later.
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
