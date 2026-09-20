import {createHash} from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const hashToUlid = (input: string): string => {
	const bytes = createHash('sha256').update(input).digest();

	let value = 0n;

	for (let i = 0; i < 16; i++) {
		value = (value << 8n) | BigInt(bytes[i]!);
	}

	let out = '';

	for (let i = 0; i < 26; i++) {
		const shift = BigInt((25 - i) * 5);
		out += CROCKFORD[Number((value >> shift) & 31n)];
	}

	return out;
};

export type VirtualNodeKind =
	| 'description'
	| 'assignees'
	| 'tags'
	| 'history'
	| 'diff'
	| 'comments'
	| 'attachments';

// The ids this has already derived.
//
// It is a pure function of (parentId, kind) and an expensive one — a SHA-256
// and a 26-step BigInt walk — and the TUI asks for all seven of a ticket's
// every time that ticket's virtual fields are refreshed: on boot, after a
// write that touches it, and on every step of a scrub, which re-materializes
// from scratch. A full refresh of a three-thousand-ticket board went from
// 71-77 ms to 34-40 ms.
//
// Unbounded on purpose: the key set is the tickets a process has seen, seven
// entries each, and the ids are permanent — a board large enough for this to
// matter is one where re-deriving them matters more.
const derived = new Map<string, string>();

export const virtualNodeId = (
	parentId: string,
	kind: VirtualNodeKind,
): string => {
	const key = `${parentId}:virtual:${kind}`;

	const cached = derived.get(key);
	if (cached !== undefined) return cached;

	const id = hashToUlid(key);
	derived.set(key, id);

	return id;
};
