import {AppEvent} from '../../event/event.model.js';
import {AnyContext} from './context.model.js';

export type NavNode<U extends AnyContext> = {
	id: string;
	title: string;
	isDeleted: boolean;
	props: Partial<{value: string}>;
	context: U;
	parentNodeId: string | null;
	rank: string;
	childRenderAxis: 'vertical' | 'horizontal';
	childNavigationAcrossParents?: boolean;
	readonly: boolean;
	log: AppEvent[];
};
