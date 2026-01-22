import {BoardItemTypes} from '../../board/model/board.model.js';

export type NavigationTree<TMeta = Record<string, unknown>> = {
	id: string;
	isSelected: boolean;
	childrenRenderAxis: 'vertical' | 'horizontal';
	name: string;
	description?: string;
	children: NavigationTree<unknown>[];
	actionContext: (typeof BoardItemTypes)[keyof typeof BoardItemTypes];
	enableChildNavigationAcrossContainers?: boolean;
} & TMeta;
