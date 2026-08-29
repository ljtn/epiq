import {NODE_REF_LENGTH} from '../../../lib/utils/node-ref.js';

// A ref is the tail of a ULID, so Crockford base32: digits plus letters minus
// I, L, O and U. Matching on shape alone is not enough to tell one from an
// ordinary uppercase word (SEGMENT fits) or an uppercase short sha, which is
// why every match is still checked against the refs that actually exist.
const REF_SHAPE = `[0-9A-HJKMNP-TV-Z]{${NODE_REF_LENGTH}}`;

// Not a real URL scheme: it only has to survive the markdown pipeline as a
// link target so MarkdownContent can recognise it and render a control rather
// than an anchor.
export const TICKET_REF_URL_PREFIX = 'epiq-ref:';

// Structural subset of mdast — enough to walk and rewrite, without taking a
// dependency on the full AST types for a plugin this small.
type MdastNode = {
	type: string;
	value?: string;
	url?: string;
	children?: MdastNode[];
};

const toRefLink = (ref: string, child: MdastNode): MdastNode => ({
	type: 'link',
	url: `${TICKET_REF_URL_PREFIX}${ref}`,
	children: [child],
});

const splitTextOnRefs = (
	value: string,
	isKnownRef: (ref: string) => boolean,
): MdastNode[] => {
	// Built per call: a shared /g regex carries lastIndex between calls.
	const pattern = new RegExp(`\\b${REF_SHAPE}\\b`, 'g');

	const out: MdastNode[] = [];
	let lastIndex = 0;

	for (const match of value.matchAll(pattern)) {
		const ref = match[0];
		if (match.index === undefined || !isKnownRef(ref)) continue;

		if (match.index > lastIndex) {
			out.push({type: 'text', value: value.slice(lastIndex, match.index)});
		}

		out.push(toRefLink(ref, {type: 'text', value: ref}));
		lastIndex = match.index + ref.length;
	}

	// No known ref in this node: hand back the original so the tree is
	// untouched rather than rebuilt into an equivalent one.
	if (out.length === 0) return [{type: 'text', value}];

	if (lastIndex < value.length) {
		out.push({type: 'text', value: value.slice(lastIndex)});
	}

	return out;
};

// Turns every mention of a ref that resolves to a real ticket into a link,
// covering both bare prose mentions and ones written as inline code — both
// forms are already in use across the board's own comments.
export const remarkTicketRefs =
	(isKnownRef: (ref: string) => boolean) => () => (tree: MdastNode) => {
		const visit = (node: MdastNode): void => {
			if (!node.children) return;

			// Nesting a link inside a link is invalid, and an explicit link's text
			// is the author's own label — neither should be rewritten.
			if (node.type === 'link') return;

			node.children = node.children.flatMap((child): MdastNode[] => {
				if (
					child.type === 'inlineCode' &&
					child.value &&
					isKnownRef(child.value)
				) {
					return [toRefLink(child.value, child)];
				}

				if (child.type === 'text' && child.value) {
					return splitTextOnRefs(child.value, isKnownRef);
				}

				visit(child);
				return [child];
			});
		};

		visit(tree);
	};
