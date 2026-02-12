import {Context} from '../../board/model/context.model.js';

export type NavigationTree<TMeta = Record<string, unknown>> = {
	id: string;
	isSelected: boolean;
	childrenRenderAxis: 'vertical' | 'horizontal';
	name: string;
	description?: string;
	children: NavigationTree<unknown>[];
	actionContext: (typeof Context)[keyof typeof Context];
	enableChildNavigationAcrossContainers?: boolean;
} & TMeta;
