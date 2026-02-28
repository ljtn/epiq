import {ContextMap, AnyContext} from './context.model.js';

export type NavNode<U extends AnyContext> = {
	id: string;
	isSelected: boolean;
	childRenderAxis: 'vertical' | 'horizontal';
	fields: Record<'title' | 'value', string> | Record<string, string>;
	context: U;
	children: (U extends ContextMap['WORKSPACE']
		? NavNode<'BOARD'>
		: U extends ContextMap['BOARD']
		? NavNode<'SWIMLANE'>
		: U extends ContextMap['SWIMLANE']
		? NavNode<'TICKET'>
		: U extends ContextMap['TICKET']
		? NavNode<'TICKET_FIELD'>
		: NavNode<'TICKET_FIELD'>)[];
	childNavigationAcrossParents?: boolean;
};
