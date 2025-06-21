export const BoardActions: BoardActionMap = {
	[BoardItemTypes.BOARD]: [],
	[BoardItemTypes.SWIMLANE]: [],
	[BoardItemTypes.TICKET]: [
		{
			key: 'm',
			description: '[M] Move ticket',
			mode: 'default',
			action: () => {
				navigationState.mode = 'move';
			},
		},
		{
			key: 'enter',
			description: '[ENTER] Confirm move',
			mode: 'move',
			action: () => {
				navigationState.mode = 'default';
			},
		},
		{
			key: 'right',
			mode: 'move',
			description: '[Right arrow] Move to the right',
			action: ctx => {
				const ancestors = ctx.breadCrumb;
				const parent = ancestors.at(-1);
				const grandParent = ancestors.at(-2);
				if (!parent || !grandParent) return;

				const parentIndex = grandParent.children.findIndex(
					x => x.id === parent.id,
				);
				if (parentIndex < 0 || parentIndex >= grandParent.children.length - 1)
					return;

				const rightSibling = grandParent.children[parentIndex + 1];
				if (!rightSibling?.children) return;

				const index = ctx._selectedIndex;
				if (index < 0 || index >= parent.children.length) return;

				const [node] = parent.children.splice(index, 1);
				rightSibling.children.push(node);

				const newBreadCrumb = [...ctx.breadCrumb.slice(0, -1), rightSibling];
				const newIndex = rightSibling.children.length - 1;
				ctx.reInvokeNavigate(newIndex, newBreadCrumb);
			},
		},
		{
			key: 'left',
			mode: 'move',
			description: '[Left arrow] Move to the left',
			action: ctx => {
				const ancestors = ctx.breadCrumb;
				const parent = ancestors.at(-1);
				const grandParent = ancestors.at(-2);
				if (!parent || !grandParent) return;

				const parentIndex = grandParent.children.findIndex(
					x => x.id === parent.id,
				);
				if (parentIndex <= 0) return;

				const leftSibling = grandParent.children[parentIndex - 1];
				if (!leftSibling?.children) return;

				const index = ctx._selectedIndex;
				if (index < 0 || index >= parent.children.length) return;

				const [node] = parent.children.splice(index, 1);
				leftSibling.children.push(node);

				const newBreadCrumb = [...ctx.breadCrumb.slice(0, -1), leftSibling];
				const newIndex = leftSibling.children.length - 1;
				ctx.reInvokeNavigate(newIndex, newBreadCrumb);
			},
		},
	],
};
