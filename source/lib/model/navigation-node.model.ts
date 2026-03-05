import {ContextMap, AnyContext} from './context.model.js';

export type NavNode<U extends AnyContext> = {
	readonly id: string;
	readonly childRenderAxis: 'vertical' | 'horizontal';
	readonly name: string;
	readonly props: Record<string, string>;
	readonly context: U;
	readonly children: readonly (U extends ContextMap['WORKSPACE']
		? NavNode<'BOARD'>
		: U extends ContextMap['BOARD']
		? NavNode<'SWIMLANE'>
		: U extends ContextMap['SWIMLANE']
		? NavNode<'TICKET'>
		: U extends ContextMap['TICKET']
		? NavNode<'FIELD'> | NavNode<'FIELD_LIST'>
		: NavNode<'FIELD'>)[];
	readonly childNavigationAcrossParents?: boolean;
};
