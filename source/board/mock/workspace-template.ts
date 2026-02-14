import {contextMap, Workspace} from '../model/context.model.js';

export const workspace: Workspace = {
	id: 'w1',
	isSelected: false,
	name: 'Workspace',
	context: contextMap.WORKSPACE,
	childrenRenderAxis: 'vertical',
	children: [
		{
			id: 'b1',
			isSelected: false,
			name: 'Default Board',
			context: contextMap.BOARD,
			childrenRenderAxis: 'horizontal',
			children: [
				{
					isSelected: false,
					id: '17a78331-7ad0-4389-a5bd-e05e54c8d6a4',
					name: 'To Do',
					childrenRenderAxis: 'vertical',
					context: contextMap.SWIMLANE,
					enableChildNavigationAcrossContainers: true,
					children: [],
				},
				{
					isSelected: false,
					id: 'c4d74a6b-37cf-447f-8d4c-8b3288320ccc',
					name: 'In progress',
					childrenRenderAxis: 'vertical',
					context: contextMap.SWIMLANE,
					enableChildNavigationAcrossContainers: true,
					children: [],
				},
				{
					isSelected: false,
					id: '207b58f5-093e-47b7-84e4-f9e75a446285',
					name: 'Review',
					childrenRenderAxis: 'vertical',
					context: contextMap.SWIMLANE,
					enableChildNavigationAcrossContainers: true,
					children: [],
				},
				{
					isSelected: false,
					id: 'fa5bbe26-5b22-40f7-9d3c-612185d152fe',
					name: 'Done',
					childrenRenderAxis: 'vertical',
					context: contextMap.SWIMLANE,
					enableChildNavigationAcrossContainers: true,
					children: [],
				},
			],
		},
		{
			id: 'b2',
			isSelected: false,
			name: 'Demo',
			context: contextMap.BOARD,
			childrenRenderAxis: 'horizontal',
			children: [
				{
					isSelected: false,
					id: 's1',
					name: 'To Do',
					childrenRenderAxis: 'vertical',
					context: contextMap.SWIMLANE,
					enableChildNavigationAcrossContainers: true,
					children: [
						{
							isSelected: false,
							id: 't1',
							name: 'Setup CI/CD pipeline',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't1-desc',
									name: 'Description',
									value:
										'Configure GitHub Actions for test, build, and deploy stages. \nAlso other cool stuff that I don`t know that to do about. This is such a long description. \n\nAnd it keeps going. It basically never ends.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
								{
									isSelected: false,
									id: 't1-desc',
									name: 'Tags',
									value: 'Urgent',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't2',
							name: 'Create API contract for auth service',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't2-desc',
									name: 'Description',
									value:
										'Define request/response formats, error handling, and versioning.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't3',
							name: 'Draft OKRs for Q4',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't3-desc',
									name: 'Description',
									value:
										'Collaborate with leads to define team goals and key results.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't11',
							name: 'Define system architecture diagram',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't11-desc',
									name: 'Description',
									value:
										'Create high-level overview of services, databases, and communication flows.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't12',
							name: 'Setup monitoring and alerting',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't12-desc',
									name: 'Description',
									value:
										'Integrate tools like Prometheus and Grafana; define alert thresholds.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't13',
							name: 'Research data privacy regulations',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't13-desc',
									name: 'Description',
									value:
										'Identify GDPR and CCPA implications for data handling and user consent.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't14',
							name: 'Draft project onboarding guide',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't14-desc',
									name: 'Description',
									value:
										'Write setup instructions, repo structure, and coding standards.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't15',
							name: 'Evaluate state management solutions',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't15-desc',
									name: 'Description',
									value:
										'Compare Redux Toolkit, Zustand, and Jotai for frontend scalability.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't16',
							name: 'Write integration test plan',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't16-desc',
									name: 'Description',
									value: 'Define test scenarios covering API and UI flows.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't17',
							name: 'Create performance benchmarks',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't17-desc',
									name: 'Description',
									value:
										'Set baseline response times for key endpoints and UI interactions.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't18',
							name: 'Design error handling strategy',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't18-desc',
									name: 'Description',
									value:
										'Standardize client and server error formats and fallback UIs.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't19',
							name: 'Define logging strategy',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't19-desc',
									name: 'Description',
									value:
										'Choose log levels, format, and storage mechanisms for observability.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't20',
							name: 'Setup feature flag framework',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't20-desc',
									name: 'Description',
									value:
										'Enable gradual rollouts using LaunchDarkly or Unleash.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't21',
							name: 'Conduct competitor analysis',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't21-desc',
									name: 'Description',
									value:
										'List comparable products and key differentiators for positioning.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't22',
							name: 'Organize kick-off meeting',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't22-desc',
									name: 'Description',
									value:
										'Schedule initial sync with stakeholders and present roadmap.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't23',
							name: 'Provision cloud infrastructure',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't23-desc',
									name: 'Description',
									value: 'Set up base AWS resources using Terraform templates.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't24',
							name: 'Define user personas',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't24-desc',
									name: 'Description',
									value:
										'Collaborate with design to outline primary users and their needs.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't25',
							name: 'Plan retro cadence and format',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't25-desc',
									name: 'Description',
									value:
										'Decide on tools, frequency, and feedback channels for retrospectives.',
									context: contextMap.TICKET,
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
					context: 'SWIMLANE',
					enableChildNavigationAcrossContainers: true,
					children: [],
				},
				{
					isSelected: false,
					id: 's3',
					name: 'Review',
					childrenRenderAxis: 'vertical',
					context: 'SWIMLANE',
					enableChildNavigationAcrossContainers: true,
					children: [
						{
							isSelected: false,
							id: 't4',
							name: 'Implement user login flow',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't4-desc',
									name: 'Description',
									value:
										'Integrate frontend with backend auth API and handle edge cases.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't5',
							name: 'Design new dashboard layout',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't5-desc',
									name: 'Description',
									value:
										'Collaborate with UX to create a grid-based responsive dashboard.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't6',
							name: 'Accessibility audit',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't6-desc',
									name: 'Description',
									value:
										'Evaluate color contrast, ARIA usage, and keyboard nav.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't7',
							name: 'Code review for analytics module',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't7-desc',
									name: 'Description',
									value:
										'Ensure test coverage, types, and data validation are in place.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't8',
							name: 'Review UI polish for mobile view',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't8-desc',
									name: 'Description',
									value:
										'Verify spacing, responsiveness, and visual hierarchy.',
									context: contextMap.TICKET,
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
					context: 'SWIMLANE',
					enableChildNavigationAcrossContainers: true,
					children: [
						{
							isSelected: false,
							id: 't9',
							name: 'Setup Storybook',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't9-desc',
									name: 'Description',
									value:
										'Document reusable components and tokens in Storybook.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
						{
							isSelected: false,
							id: 't10',
							name: 'Deploy v1.2 to staging',
							context: contextMap.TICKET_LIST_ITEM,
							childrenRenderAxis: 'vertical',
							children: [
								{
									isSelected: false,
									id: 't10-desc',
									name: 'Description',
									value: 'All pipelines green. Ready for product team QA.',
									context: contextMap.TICKET,
									childrenRenderAxis: 'vertical',
									children: [],
								},
							],
						},
					],
				},
			],
		},
	],
};
