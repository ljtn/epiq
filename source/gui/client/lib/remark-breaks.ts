import type {MdastNode} from './remark-ticket-refs';

const NEWLINE = /\r?\n|\r/;

const splitOnNewlines = (child: MdastNode, value: string): MdastNode[] => {
	const lines = value.split(NEWLINE);
	if (lines.length === 1) return [child];

	return lines.flatMap((line, index): MdastNode[] => [
		...(index > 0 ? [{type: 'break'}] : []),
		...(line ? [{type: 'text', value: line}] : []),
	]);
};

// Every line ending in prose renders as a line break, as in a chat message.
export const remarkBreaks = () => (tree: MdastNode) => {
	const visit = (node: MdastNode): void => {
		if (!node.children) return;

		node.children = node.children.flatMap((child): MdastNode[] => {
			if (child.type === 'text' && child.value !== undefined) {
				return splitOnNewlines(child, child.value);
			}

			visit(child);
			return [child];
		});
	};

	visit(tree);
};
