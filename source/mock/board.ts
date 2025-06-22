import {BoardItemTypes, type Board} from '../lib/types/board.model.js';

export const board: Board = {
	id: 'b1',
	isSelected: false,
	name: 'Product Development Board',
	actionContext: 'BOARD',
	childrenRenderAxis: 'horizontal',
	children: [
		{
			isSelected: false,
			id: 's1',
			name: 'To Do',
			childrenRenderAxis: 'vertical',
			actionContext: BoardItemTypes.SWIMLANE,
			enableChildNavigationAcrossContainers: true,
			children: [
				{
					isSelected: false,
					id: 't1',
					name: 'Setup CI/CD pipeline',
					actionContext: 'TICKET',
					childrenRenderAxis: 'vertical',
					description:
						'Configure GitHub Actions for test, build, and deploy stages.',
					children: [],
				},
				{
					isSelected: false,
					id: 't2',
					name: 'Create API contract for auth service',
					actionContext: 'TICKET',
					childrenRenderAxis: 'vertical',
					description:
						'Define request/response formats, error handling, and versioning.',
					children: [],
				},
				{
					isSelected: false,
					id: 't3',
					name: 'Draft OKRs for Q4',
					actionContext: 'TICKET',
					childrenRenderAxis: 'vertical',
					description:
						'Collaborate with leads to define team goals and key results.',
					children: [],
				},
			],
		},
		{
			isSelected: false,
			id: 's2',
			name: 'In Progress',
			childrenRenderAxis: 'vertical',
			actionContext: 'SWIMLANE',
			enableChildNavigationAcrossContainers: true,
			children: [
				{
					isSelected: false,
					id: 't4',
					name: 'Implement user login flow',
					actionContext: 'TICKET',
					childrenRenderAxis: 'vertical',
					description:
						'Integrate frontend with backend auth API and handle edge cases.',
					children: [],
				},
				{
					isSelected: false,
					id: 't5',
					name: 'Design new dashboard layout',
					actionContext: 'TICKET',
					childrenRenderAxis: 'vertical',
					description:
						'Collaborate with UX to create a grid-based responsive dashboard.',
					children: [],
				},
				{
					isSelected: false,
					id: 't6',
					name: 'Accessibility audit',
					actionContext: 'TICKET',
					childrenRenderAxis: 'vertical',
					description: 'Evaluate color contrast, ARIA usage, and keyboard nav.',
					children: [],
				},
			],
		},
		{
			isSelected: false,
			id: 's3',
			name: 'Review',
			childrenRenderAxis: 'vertical',
			actionContext: 'SWIMLANE',
			enableChildNavigationAcrossContainers: true,
			children: [
				{
					isSelected: false,
					id: 't7',
					name: 'Code review for analytics module',
					actionContext: 'TICKET',
					childrenRenderAxis: 'vertical',
					description:
						'Ensure test coverage, types, and data validation are in place.',
					children: [],
				},
				{
					isSelected: false,
					id: 't8',
					name: 'Review UI polish for mobile view',
					actionContext: 'TICKET',
					childrenRenderAxis: 'vertical',
					description: 'Verify spacing, responsiveness, and visual hierarchy.',
					children: [],
				},
			],
		},
		{
			isSelected: false,
			id: 's4',
			name: 'Done',
			childrenRenderAxis: 'vertical',
			actionContext: 'SWIMLANE',
			enableChildNavigationAcrossContainers: true,
			children: [
				{
					isSelected: false,
					id: 't9',
					name: 'Setup Storybook',
					actionContext: 'TICKET',
					childrenRenderAxis: 'vertical',
					description: 'Document reusable components and tokens in Storybook.',
					children: [],
				},
				{
					isSelected: false,
					id: 't10',
					name: 'Deploy v1.2 to staging',
					actionContext: 'TICKET',
					childrenRenderAxis: 'vertical',
					description: 'All pipelines green. Ready for product team QA.',
					children: [],
				},
			],
		},
	],
};
