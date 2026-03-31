import {AnyContext} from './context.model.js';

export type NavNode<U extends AnyContext> = {
	id: string;
	title: string;
	isDeleted: boolean;
	props: Partial<{value: string | string[]}>;
	context: U;
	parentNodeId: string | null;
	rank: string;
	childRenderAxis: 'vertical' | 'horizontal';
	childNavigationAcrossParents?: boolean;
};
