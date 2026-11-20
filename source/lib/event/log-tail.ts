// What a process has read of the log, without holding a single entry of it:
// where it stopped in each file, enough of the order to append to it, and
// which ids it holds. A read then takes only what is new, or says to rebuild.

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {isFail} from '../model/result-types.js';
import {isPendingFileName} from './pending-log.js';
import {listEventFiles} from './log-signature.js';
import {
	appendToOrder,
	parseLogLines,
	type LogTailSeed,
	type ReconstructedEvent,
	type UnreadableEvent,
} from './event-load.js';

// ---------------------------------------------------------------------------
// Held ids: a Bloom filter, so "not held" is certain and "held" only likely,
// which a read treats as held.

export type HeldIds = {bits: Uint8Array; hashes: number; count: number};

const BITS_PER_ID = 10;
const HASHES = 7;

export const heldIdsFor = (
	ids: Iterable<string>,
	capacity: number,
): HeldIds => {
	const held: HeldIds = {
		bits: new Uint8Array(
			Math.ceil((Math.max(capacity, 1024) * BITS_PER_ID) / 8),
		),
		hashes: HASHES,
		count: 0,
	};
	for (const id of ids) holdId(held, id);
	return held;
};

// Two FNV-1a variants combined into k positions (double hashing).
const positionsOf = (held: HeldIds, id: string): number[] => {
	let a = 0x811c9dc5;
	let b = 0x01000193;
	for (let index = 0; index < id.length; index++) {
		const code = id.charCodeAt(index);
		a = Math.imul(a ^ code, 0x01000193) >>> 0;
		b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
	}
	const size = held.bits.length * 8;
	return Array.from(
		{length: held.hashes},
		(_, k) => ((a + Math.imul(k, b | 1)) >>> 0) % size,
	);
};

const holdId = (held: HeldIds, id: string): void => {
	for (const position of positionsOf(held, id)) {
		held.bits[position >> 3]! |= 1 << (position & 7);
	}
	held.count++;
};

export const mayHoldId = (held: HeldIds, id: string): boolean =>
	positionsOf(held, id).every(
		position => (held.bits[position >> 3]! & (1 << (position & 7))) !== 0,
	);

// Past this many ids per slot sized for, "maybe" is too often a lie: rebuild.
const isOverfull = (held: HeldIds): boolean =>
	held.count * BITS_PER_ID > held.bits.length * 8 * 2;

// ---------------------------------------------------------------------------

export type TailFile = {
	bytes: number;
	lines: number;
	hash: string;
	// Size and mtime when read, and whether that stamp was settled then: a
	// settled stamp unchanged is trusted in the same process, never across.
	stamp: string;
	settled: boolean;
	// Its lines that did not parse: the file's, so they go with it.
	quarantined: UnreadableEvent[];
};

export type LogTail = {
	files: Record<string, TailFile>;
	spine: ReconstructedEvent[] | null;
	waiting: string[];
	held: HeldIds;
	// Lines this actor's pending files held, by hash: a line read again with
	// the same bytes is the same event, so a sync moving them changes nothing.
	pendingLines: string[];
	// Whether every file stamp was verified by this process.
	verified: boolean;
};

export type TailRead =
	| {
			appended: ReconstructedEvent[];
			// Every unparseable line of every file read so far, as a full read
			// of the files there now lists them.
			quarantined: UnreadableEvent[];
			tail: LogTail;
	  }
	| {rebuild: string};

const hashOf = (bytes: Buffer | string): string =>
	createHash('sha1').update(bytes).digest('hex');

const NEWLINE = 0x0a;
const MS_IN_NS = 1_000_000n;

const stampOf = (
	filePath: string,
	settledFor: (ageMs: number, wholeSecond: boolean) => boolean,
): {stamp: string; settled: boolean} | null => {
	try {
		const {size, mtimeNs} = fs.statSync(filePath, {bigint: true});
		return {
			stamp: `${size}:${mtimeNs}`,
			settled: settledFor(
				Number(BigInt(Date.now()) * MS_IN_NS - mtimeNs) / 1e6,
				mtimeNs % 1_000_000_000n === 0n,
			),
		};
	} catch {
		return null;
	}
};

const lineHashes = (bytes: Buffer): string[] =>
	bytes
		.toString('utf8')
		.split('\n')
		.map(line => line.trim())
		.filter(Boolean)
		.map(line => hashOf(line));

/** The tail a load's own record of what it read makes. */
export const tailFromSeed = (seed: LogTailSeed): LogTail => ({
	files: seed.files,
	spine: seed.spine,
	waiting: seed.waiting,
	held: heldIdsFor(seed.ids, seed.idCount * 2),
	pendingLines: seed.pendingLines,
	verified: true,
});

/** What a full read of the log leaves a tail to start from. */
export const tailOf = ({
	dir,
	sorted,
	waiting,
	spine,
	settledFor,
}: {
	dir: string;
	sorted: readonly ReconstructedEvent[];
	waiting: Iterable<string>;
	spine: ReconstructedEvent[] | null;
	settledFor: (ageMs: number, wholeSecond: boolean) => boolean;
}): LogTail | null => {
	const files: Record<string, TailFile> = {};
	const pendingLines: string[] = [];

	for (const name of listEventFiles(dir)) {
		const filePath = path.join(dir, name);
		const stamp = stampOf(filePath, settledFor);
		let bytes: Buffer;
		try {
			bytes = fs.readFileSync(filePath);
		} catch {
			return null;
		}
		if (!stamp) return null;

		// Whole lines only: a piece past the last break is still being written.
		const whole = bytes.subarray(0, bytes.lastIndexOf(NEWLINE) + 1);
		const parsed = parseLogLines(whole, {filePath, firstLine: 0});
		if (isFail(parsed)) return null;
		files[name] = {
			bytes: whole.length,
			lines: whole.toString('utf8').split('\n').length - 1,
			hash: hashOf(whole),
			...stamp,
			quarantined: parsed.value.quarantined,
		};
		if (isPendingFileName(name)) pendingLines.push(...lineHashes(whole));
	}

	const ids = new Set(sorted.map(entry => entry.id[0]));
	return {
		files,
		spine,
		waiting: [...waiting],
		held: heldIdsFor(ids, ids.size * 2),
		pendingLines,
		verified: true,
	};
};

/**
 * What the log holds past `tail`, in the order a full sort gives it, or a
 * reason only a full read is exact. Never writes into `tail`.
 */
export const readTail = (
	dir: string,
	tail: LogTail,
	settledFor: (ageMs: number, wholeSecond: boolean) => boolean,
): TailRead => {
	const names = listEventFiles(dir);
	const present = new Set(names);
	const files: Record<string, TailFile> = {};
	const pendingLines = new Set(tail.pendingLines);
	const nextPendingLines = [...tail.pendingLines];
	const fresh: ReconstructedEvent[] = [];

	for (const name of Object.keys(tail.files)) {
		// A pending file a sync folded away: its lines were read already.
		if (!present.has(name) && !isPendingFileName(name)) {
			return {rebuild: `${name} is gone`};
		}
	}

	for (const name of names) {
		const filePath = path.join(dir, name);
		const held = tail.files[name];
		const stamp = stampOf(filePath, settledFor);
		if (!stamp) return {rebuild: `${name} vanished mid-read`};

		if (held && tail.verified && held.settled && held.stamp === stamp.stamp) {
			files[name] = held;
			continue;
		}

		let bytes: Buffer;
		try {
			bytes = fs.readFileSync(filePath);
		} catch {
			return {rebuild: `${name} vanished mid-read`};
		}

		const from = held?.bytes ?? 0;
		if (
			held &&
			(bytes.length < held.bytes ||
				hashOf(bytes.subarray(0, held.bytes)) !== held.hash)
		) {
			return {rebuild: `${name} changed before where it was read to`};
		}

		// Whole lines only: a piece past the last break is still being written,
		// by another process or a pull, and is read once it ends.
		const end = Math.max(from, bytes.lastIndexOf(NEWLINE) + 1);
		const added = bytes.subarray(from, end);
		const parsed = parseLogLines(added, {
			filePath,
			firstLine: held?.lines ?? 0,
		});
		if (isFail(parsed)) return {rebuild: parsed.message};

		for (const {entry, line} of parsed.value.entries) {
			const lineHash = hashOf(line);
			// The same bytes as a line already read: the same event, held once.
			if (pendingLines.has(lineHash)) continue;
			if (isPendingFileName(name)) nextPendingLines.push(lineHash);
			fresh.push(entry);
		}

		files[name] = {
			bytes: end,
			lines: (held?.lines ?? 0) + added.toString('utf8').split('\n').length - 1,
			hash: hashOf(bytes.subarray(0, end)),
			...stamp,
			quarantined: [...(held?.quarantined ?? []), ...parsed.value.quarantined],
		};
	}

	// Anything that might already be held could sort in among what is: the
	// append rule declines it.
	const appended = appendToOrder(
		{
			ids: {has: id => mayHoldId(tail.held, id)},
			waiting: new Set(tail.waiting),
			spine: tail.spine,
		},
		fresh,
	);
	if (!appended) return {rebuild: 'the new events do not land after the order'};

	const held: HeldIds = {...tail.held, bits: tail.held.bits.slice()};
	for (const entry of appended.order) holdId(held, entry.id[0]);
	if (isOverfull(held)) return {rebuild: 'too many ids for the filter'};

	const pendingLeft = names.some(isPendingFileName);

	return {
		appended: appended.order,
		quarantined: names.flatMap(name => files[name]?.quarantined ?? []),
		tail: {
			files,
			spine: appended.spine,
			waiting: tail.waiting,
			held,
			// Kept while a pending file may still be folded; none left, none needed.
			pendingLines: pendingLeft ? nextPendingLines : [],
			verified: true,
		},
	};
};

/**
 * `tail` with a line this process has just appended to `filePath`: null
 * unless the file is exactly what it held plus that line, and the event lands
 * after the order, so the next read starts from a tail that is still exact.
 */
export const withOwnLine = (
	dir: string,
	tail: LogTail,
	filePath: string,
	line: string,
	settledFor: (ageMs: number, wholeSecond: boolean) => boolean,
): LogTail | null => {
	const name = path.basename(filePath);
	const held = tail.files[name];
	const appendedBytes = Buffer.byteLength(line);
	if (!line.endsWith('\n')) return null;

	let bytes: Buffer;
	try {
		bytes = fs.readFileSync(path.join(dir, name));
	} catch {
		return null;
	}
	const before = held?.bytes ?? 0;
	if (
		bytes.length !== before + appendedBytes ||
		(held && hashOf(bytes.subarray(0, before)) !== held.hash) ||
		!bytes.subarray(before).equals(Buffer.from(line))
	) {
		return null;
	}

	const parsed = parseLogLines(Buffer.from(line), {
		filePath,
		firstLine: held?.lines ?? 0,
	});
	if (isFail(parsed) || parsed.value.entries.length !== 1) return null;
	const [{entry, line: trimmed}] = parsed.value.entries as [
		{entry: ReconstructedEvent; line: string},
	];

	const appended = appendToOrder(
		{
			ids: {has: id => mayHoldId(tail.held, id)},
			waiting: new Set(tail.waiting),
			spine: tail.spine,
		},
		[entry],
	);
	const stamp = stampOf(path.join(dir, name), settledFor);
	if (!appended || !stamp) return null;

	const heldIds: HeldIds = {...tail.held, bits: tail.held.bits.slice()};
	holdId(heldIds, entry.id[0]);

	return {
		...tail,
		files: {
			...tail.files,
			[name]: {
				bytes: bytes.length,
				lines: (held?.lines ?? 0) + 1,
				hash: hashOf(bytes),
				...stamp,
				quarantined: held?.quarantined ?? [],
			},
		},
		spine: appended.spine,
		held: heldIds,
		pendingLines: isPendingFileName(name)
			? [...tail.pendingLines, hashOf(trimmed)]
			: tail.pendingLines,
	};
};
