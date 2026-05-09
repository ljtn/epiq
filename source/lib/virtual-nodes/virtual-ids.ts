import {decodeTime, encodeTime} from 'ulid';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const hashToUlidRandomPart = (input: string): string => {
	let hash = 2166136261;

	for (const char of input) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 16777619);
	}

	let value = BigInt(hash >>> 0);
	let out = '';

	for (let i = 0; i < 16; i++) {
		value = (value * 1103515245n + 12345n) & 0xffffffffn;
		out += CROCKFORD[Number(value % 32n)];
	}

	return out;
};

export const virtualNodeId = (
	parentId: string,
	kind: 'description' | 'assignees' | 'tags' | 'history',
): string => {
	const time = decodeTime(parentId);
	return encodeTime(time, 10) + hashToUlidRandomPart(`${parentId}:${kind}`);
};
