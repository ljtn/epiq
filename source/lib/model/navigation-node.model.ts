import {AnyContext} from './context.model.js';

export type NavNode<U extends AnyContext> = {
	id: string;
	parentNodeId: string | null;
	children: string[];
	context: U;
	childRenderAxis: 'vertical' | 'horizontal';
	name: string;
	props: Record<string, string>;
	childNavigationAcrossParents?: boolean;
};
