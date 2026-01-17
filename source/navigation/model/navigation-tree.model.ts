export type NavigationTree<TMeta = Record<string, unknown>> = {
	id: string;
	isSelected: boolean;
	childrenRenderAxis: 'vertical' | 'horizontal';
	name: string;
	description?: string;
	children: NavigationTree<unknown>[];
	actionContext: string;
	enableChildNavigationAcrossContainers?: boolean;
} & TMeta;
