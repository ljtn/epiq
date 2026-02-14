import {ContextMap, AnyContext} from '../../board/model/context.model.js';

export type NavNode<U extends AnyContext = 'WORKSPACE'> = {
	id: string;
	isSelected: boolean;
	childrenRenderAxis: 'vertical' | 'horizontal';
	name: string;
	value?: string;
	context: U;
	children: (U extends ContextMap['WORKSPACE']
		? NavNode<'BOARD'>
		: U extends ContextMap['BOARD']
		? NavNode<'SWIMLANE'>
		: U extends ContextMap['SWIMLANE']
		? NavNode<'TICKET_LIST_ITEM'>
		: U extends ContextMap['TICKET_LIST_ITEM']
		? NavNode<'TICKET'>
		: NavNode<'TICKET'>)[];
	enableChildNavigationAcrossContainers?: boolean;
};
