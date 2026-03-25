import {AnyContext} from './context.model.js';

export type NavNode<U extends AnyContext> = {
	id: string;
	title: string;
	props: Record<string, string>;
	context: U;
	children: string[];
	parentNodeId: string | null;
	childRenderAxis: 'vertical' | 'horizontal';
	childNavigationAcrossParents?: boolean;
};
