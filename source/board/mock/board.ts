import {Board, Context} from '../model/context.model.js';
// import {Board, BoardItemTypes} from '../model/board.model.js';

export const board: Board = {
	id: 'b1',
	isSelected: false,
	name: 'Board',
	actionContext: Context.BOARD,
	childrenRenderAxis: 'horizontal',
	// children: [
	// 	{
	// 		isSelected: false,
	// 		id: 's1',
	// 		name: 'To Do',
	// 		childrenRenderAxis: 'vertical',
	// 		actionContext: BoardItemTypes.SWIMLANE,
	// 		enableChildNavigationAcrossContainers: true,
	// 		children: [],
	// 	},
	// ],
	children: [
		{
			isSelected: false,
			id: 's1',
			name: 'To Do',
			childrenRenderAxis: 'vertical',
			actionContext: Context.SWIMLANE,
			enableChildNavigationAcrossContainers: true,
			children: [
				{
					isSelected: false,
					id: 't1',
					name: 'Setup CI/CD pipeline',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't1-desc',
							name: 'Description',
							description:
								'Configure GitHub Actions for test, build, and deploy stages.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
						{
							isSelected: false,
							id: 't1-desc',
							name: 'Tag',
							description: 'Urgent',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't2',
					name: 'Create API contract for auth service',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't2-desc',
							name: 'Description',
							description:
								'Define request/response formats, error handling, and versioning.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't3',
					name: 'Draft OKRs for Q4',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't3-desc',
							name: 'Description',
							description:
								'Collaborate with leads to define team goals and key results.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't11',
					name: 'Define system architecture diagram',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't11-desc',
							name: 'Description',
							description:
								'Create high-level overview of services, databases, and communication flows.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't12',
					name: 'Setup monitoring and alerting',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't12-desc',
							name: 'Description',
							description:
								'Integrate tools like Prometheus and Grafana; define alert thresholds.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't13',
					name: 'Research data privacy regulations',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't13-desc',
							name: 'Description',
							description:
								'Identify GDPR and CCPA implications for data handling and user consent.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't14',
					name: 'Draft project onboarding guide',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't14-desc',
							name: 'Description',
							description:
								'Write setup instructions, repo structure, and coding standards.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't15',
					name: 'Evaluate state management solutions',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't15-desc',
							name: 'Description',
							description:
								'Compare Redux Toolkit, Zustand, and Jotai for frontend scalability.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't16',
					name: 'Write integration test plan',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't16-desc',
							name: 'Description',
							description: 'Define test scenarios covering API and UI flows.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't17',
					name: 'Create performance benchmarks',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't17-desc',
							name: 'Description',
							description:
								'Set baseline response times for key endpoints and UI interactions.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't18',
					name: 'Design error handling strategy',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't18-desc',
							name: 'Description',
							description:
								'Standardize client and server error formats and fallback UIs.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't19',
					name: 'Define logging strategy',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't19-desc',
							name: 'Description',
							description:
								'Choose log levels, format, and storage mechanisms for observability.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't20',
					name: 'Setup feature flag framework',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't20-desc',
							name: 'Description',
							description:
								'Enable gradual rollouts using LaunchDarkly or Unleash.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't21',
					name: 'Conduct competitor analysis',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't21-desc',
							name: 'Description',
							description:
								'List comparable products and key differentiators for positioning.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't22',
					name: 'Organize kick-off meeting',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't22-desc',
							name: 'Description',
							description:
								'Schedule initial sync with stakeholders and present roadmap.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't23',
					name: 'Provision cloud infrastructure',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't23-desc',
							name: 'Description',
							description:
								'Set up base AWS resources using Terraform templates.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't24',
					name: 'Define user personas',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't24-desc',
							name: 'Description',
							description:
								'Collaborate with design to outline primary users and their needs.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't25',
					name: 'Plan retro cadence and format',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't25-desc',
							name: 'Description',
							description:
								'Decide on tools, frequency, and feedback channels for retrospectives.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
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
			children: [],
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
					id: 't4',
					name: 'Implement user login flow',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't4-desc',
							name: 'Description',
							description:
								'Integrate frontend with backend auth API and handle edge cases.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't5',
					name: 'Design new dashboard layout',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't5-desc',
							name: 'Description',
							description:
								'Collaborate with UX to create a grid-based responsive dashboard.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't6',
					name: 'Accessibility audit',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't6-desc',
							name: 'Description',
							description:
								'Evaluate color contrast, ARIA usage, and keyboard nav.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't7',
					name: 'Code review for analytics module',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't7-desc',
							name: 'Description',
							description:
								'Ensure test coverage, types, and data validation are in place.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't8',
					name: 'Review UI polish for mobile view',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't8-desc',
							name: 'Description',
							description:
								'Verify spacing, responsiveness, and visual hierarchy.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
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
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't9-desc',
							name: 'Description',
							description:
								'Document reusable components and tokens in Storybook.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
				{
					isSelected: false,
					id: 't10',
					name: 'Deploy v1.2 to staging',
					actionContext: Context.TICKET_LIST_ITEM,
					childrenRenderAxis: 'vertical',
					children: [
						{
							isSelected: false,
							id: 't10-desc',
							name: 'Description',
							description: 'All pipelines green. Ready for product team QA.',
							actionContext: Context.TICKET,
							childrenRenderAxis: 'vertical',
							children: [],
						},
					],
				},
			],
		},
	],
};
