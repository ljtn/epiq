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

// Memoized: derivation is a SHA-256 plus a BigInt walk, asked for on every
// refresh. Unbounded, since ids are permanent.
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
