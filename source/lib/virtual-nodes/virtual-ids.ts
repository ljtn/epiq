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

export const virtualNodeId = (
	parentId: string,
	kind:
		| 'description'
		| 'assignees'
		| 'tags'
		| 'history'
		| 'comments'
		| 'attachments',
): string => hashToUlid(`${parentId}:virtual:${kind}`);
