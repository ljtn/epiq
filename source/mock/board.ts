import {BoardItemTypes, type Board} from '../lib/types/board.model.js';

export const board: Board = {
	id: 'b1',
	isSelected: false,
	name: 'Product Development Board',
	actionContext: 'BOARD',
	navigationMode: 'vertical',
	children: [
		{
			isSelected: false,
			id: 's1',
			name: 'To Do',
			navigationMode: 'horizontal',
			actionContext: BoardItemTypes.SWIMLANE,
			enableChildSelectionAcrossContainers: true,
			children: [
				{
					isSelected: false,
					id: 't1',
					name: 'Setup CI/CD pipeline',
					actionContext: 'TICKET',
					navigationMode: 'vertical',
					description:
						'Configure GitHub Actions for test, build, and deploy stages.',
					children: [],
				},
				{
					isSelected: false,
					id: 't2',
					name: 'Create API contract for auth service',
					actionContext: 'TICKET',
					navigationMode: 'vertical',
					description:
						'Define request/response formats, error handling, and versioning.',
					children: [],
				},
				{
					isSelected: false,
					id: 't3',
					name: 'Draft OKRs for Q4',
					actionContext: 'TICKET',
					navigationMode: 'vertical',
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
			navigationMode: 'vertical',
			actionContext: 'SWIMLANE',
			enableChildSelectionAcrossContainers: true,
			children: [
				{
					isSelected: false,
					id: 't4',
					name: 'Implement user login flow',
					actionContext: 'TICKET',
					navigationMode: 'vertical',
					description:
						'Integrate frontend with backend auth API and handle edge cases.',
					children: [],
				},
				{
					isSelected: false,
					id: 't5',
					name: 'Design new dashboard layout',
					actionContext: 'TICKET',
					navigationMode: 'vertical',
					description:
						'Collaborate with UX to create a grid-based responsive dashboard.',
					children: [],
				},
				{
					isSelected: false,
					id: 't6',
					name: 'Accessibility audit',
					actionContext: 'TICKET',
					navigationMode: 'vertical',
					description: 'Evaluate color contrast, ARIA usage, and keyboard nav.',
					children: [],
				},
			],
		},
		{
			isSelected: false,
			id: 's3',
			name: 'Review',
			navigationMode: 'vertical',
			actionContext: 'SWIMLANE',
			enableChildSelectionAcrossContainers: true,
			children: [
				{
					isSelected: false,
					id: 't7',
					name: 'Code review for analytics module',
					actionContext: 'TICKET',
					navigationMode: 'vertical',
					description:
						'Ensure test coverage, types, and data validation are in place.',
					children: [],
				},
				{
					isSelected: false,
					id: 't8',
					name: 'Review UI polish for mobile view',
					actionContext: 'TICKET',
					navigationMode: 'vertical',
					description: 'Verify spacing, responsiveness, and visual hierarchy.',
					children: [],
				},
			],
		},
		{
			isSelected: false,
			id: 's4',
			name: 'Done',
			navigationMode: 'vertical',
			actionContext: 'SWIMLANE',
			enableChildSelectionAcrossContainers: true,
			children: [
				{
					isSelected: false,
					id: 't9',
					name: 'Setup Storybook',
					actionContext: 'TICKET',
					navigationMode: 'vertical',
					description: 'Document reusable components and tokens in Storybook.',
					children: [],
				},
				{
					isSelected: false,
					id: 't10',
					name: 'Deploy v1.2 to staging',
					actionContext: 'TICKET',
					navigationMode: 'vertical',
					description: 'All pipelines green. Ready for product team QA.',
					children: [],
				},
			],
		},
	],
};
