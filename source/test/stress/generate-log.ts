// Writes an event log the size a team actually reaches, so the rest of the
// stress run has something real to chew on.
//
// The lines are minted the way persist() mints them — `{[action]: payload, v,
// id: [ulid, refId]}`, ULIDs that climb, a refId chain per actor — because a
// log of plausible-looking lines that fails to materialize would be worse than
// no test at all: it would look like it passed.
//
// Not a test file. Nothing runs this but `npm run stress`.

import fs from 'node:fs';
import path from 'node:path';
import {ulid} from 'ulid';
import {parseEventPayload} from '../../lib/event/event-payload.schema.js';
import {EventAction} from '../../lib/event/event.model.js';
import {isFail} from '../../lib/model/result-types.js';

export type GenerateInput = {
	stateRoot: string;
	boardId: string;
	laneIds: string[];
	actors: {userId: string; userName: string}[];
	events: number;
	years: number;
	// Which actions the log is made of, when narrowing it to one is how you
	// find out which handler is the slow one.
	shape?: readonly string[];
	// Created by the log itself, so replay has them before anything uses them.
	tagNames: string[];
};

// Roughly what a person does to a ticket, in the proportions a board actually
// sees: far more tagging and commenting than creating.
const SHAPE = [
	'add.issue',
	'add.issue.tag',
	'add.issue.tag',
	'add.issue.comment',
	'add.issue.comment',
	'move.node',
	'move.node',
	'edit.title',
	'edit.description',
	'add.issue.assignee',
] as const;

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

const RANKS = ['aQ', 'aV', 'b0', 'b5', 'cB', 'cH'];

export const generateLog = async (
	input: GenerateInput,
): Promise<{lines: number}> => {
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

	const shape = (input.shape ?? SHAPE) as readonly (typeof SHAPE)[number][];

	const start = Date.now() - input.years * YEAR_MS;
	const step = Math.max(1, Math.floor((input.years * YEAR_MS) / input.events));

	// The tail of the causal order, which is what an actor refs when it has
	// synced. Advanced globally rather than per actor so the forest is mostly a
	// chain, the way a team that syncs often really looks.
	let edge: string | null = null;

	// A minority of events ref an older edge instead: concurrent work, which is
	// what makes getSortedEvents do more than walk a list.
	let staleEdge: string | null = null;

	// Issues are referred to long after they are made, so keep a pool rather
	// than only ever touching the newest.
	const issues: string[] = [];

	let written = 0;

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

	const emit = (
		action: string,
		payload: Record<string, unknown>,
		at: number,
	) => {
		const stream = streams[written % streams.length]!;
		const id = ulid(at);

		validate(action, payload);

		stream.buffer.push(
			JSON.stringify({[action]: payload, v: 1, id: [id, edge]}),
		);

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
	const preambleCount = input.actors.length + input.tagNames.length;
	let preambleAt = start - preambleCount;

	const tagIds = input.tagNames.map((_, index) =>
		ulid(start - input.tagNames.length + index),
	);

	for (const actor of input.actors) {
		emit(
			'create.contributor',
			{id: actor.userId, name: actor.userName},
			preambleAt++,
		);
	}

	input.tagNames.forEach((name, index) => {
		emit('create.tag', {id: tagIds[index]!, name}, preambleAt++);
	});

	for (let i = 0; i < input.events; i++) {
		const stream = streams[i % streams.length]!;
		const action = shape[i % shape.length]!;

		// Climbing, and never behind the parent it points at — the same rule
		// persist() enforces when it seeds from the edge.
		const id = ulid(start + i * step);

		// Some events ref an older edge: concurrent work, which is what makes
		// getSortedEvents do more than walk a list. Never the first, though —
		// branching off the preamble makes this event a sibling of the last
		// create.tag, and siblings sort by ULID, so its whole subtree would be
		// walked before the tags it goes on to use exist.
		const refId = i > 0 && i % 17 === 0 && staleEdge ? staleEdge : edge;

		const issueId =
			action === 'add.issue'
				? ulid(start + i * step)
				: issues[i % Math.max(1, issues.length)] ?? ulid(start + i * step);

		if (action === 'add.issue') issues.push(issueId);

		const payload = buildPayload(action, {
			id: issueId,
			laneId: input.laneIds[i % input.laneIds.length]!,
			tagId: tagIds[i % tagIds.length]!,
			actorId: stream.actor.userId,
			n: i,
		});

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
	}

	// Awaited, not merely ended: `end()` returns before the bytes reach the
	// disk, and reading the log a moment later then finds a file that is empty
	// or half written — which measures an empty board and calls it a pass.
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

	return {lines: written};
};

const buildPayload = (
	action: (typeof SHAPE)[number],
	at: {id: string; laneId: string; tagId: string; actorId: string; n: number},
): Record<string, unknown> => {
	switch (action) {
		case 'add.issue':
			return {
				id: at.id,
				name: `Ticket ${at.n}: something a person actually wrote down`,
				parent: at.laneId,
				rank: RANKS[at.n % RANKS.length],
			};
		case 'add.issue.tag':
			return {id: at.id, tag: at.tagId};
		case 'add.issue.comment':
			return {
				id: ulid(),
				issue: at.id,
				// Required. Without it the event still materializes — nothing
				// validates a payload on load — and then takes the GUI down on the
				// first read, with a stack trace pointing at colour generation.
				author: at.actorId,
				md: `Had a look at this — the part to watch is the ${
					at.n % 7 === 0 ? 'window derivation' : 'ordering'
				}.`,
			};
		case 'move.node':
			return {
				id: at.id,
				parent: at.laneId,
				rank: RANKS[at.n % RANKS.length],
			};
		case 'edit.title':
			return {id: at.id, name: `Ticket ${at.n}, renamed`};
		case 'edit.description':
			return {
				id: at.id,
				md: `Longer body for ticket ${at.n}.\n\nSecond paragraph.`,
			};
		case 'add.issue.assignee':
			return {id: at.id, assignee: at.actorId};
	}
};
