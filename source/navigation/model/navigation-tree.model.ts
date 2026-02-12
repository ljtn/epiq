import {ContextMap, AnyContext} from '../../board/model/context.model.js';

export type NavigationTree<U extends AnyContext = 'WORKSPACE'> = {
	id: string;
	isSelected: boolean;
	childrenRenderAxis: 'vertical' | 'horizontal';
	name: string;
	description?: string;
	context: U;
	children: (U extends ContextMap['WORKSPACE']
		? NavigationTree<'BOARD'>
		: U extends ContextMap['BOARD']
		? NavigationTree<'SWIMLANE'>
		: U extends ContextMap['SWIMLANE']
		? NavigationTree<'TICKET_LIST_ITEM'>
		: U extends ContextMap['TICKET_LIST_ITEM']
		? NavigationTree<'TICKET'>
		: NavigationTree<'TICKET'>)[];
	enableChildNavigationAcrossContainers?: boolean;
};
