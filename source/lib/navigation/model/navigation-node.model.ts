import {ContextMap, AnyContext} from '../../model/context.model.js';

export type NavNode<U extends AnyContext = 'WORKSPACE'> = {
	id: string;
	isSelected: boolean;
	childrenRenderAxis: 'vertical' | 'horizontal';
	name: string;
	value: string;
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
	enableChildNavigationAcrossContainers?: boolean;
};
