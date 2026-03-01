import {ContextMap, AnyContext} from './context.model.js';

export type NavNode<U extends AnyContext> = {
	id: string;
	isSelected: boolean;
	childRenderAxis: 'vertical' | 'horizontal';
	name: string;
	props: Record<string, string>;
	context: U;
	children: (U extends ContextMap['WORKSPACE']
		? NavNode<'BOARD'>
		: U extends ContextMap['BOARD']
		? NavNode<'SWIMLANE'>
		: U extends ContextMap['SWIMLANE']
		? NavNode<'TICKET'>
		: U extends ContextMap['TICKET']
		? NavNode<'FIELD'>
		: NavNode<'FIELD'>)[];
	childNavigationAcrossParents?: boolean;
};
