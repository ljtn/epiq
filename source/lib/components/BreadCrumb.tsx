import {Box, Text} from 'ink';
import React from 'react';
import {isSuccess} from '../model/result-types.js';
import {
	findAncestor,
	isDescendantOf,
	nodeRepo,
} from '../repository/node-repo.js';
import {getOrderedChildren} from '../repository/rank.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {AssigneeUI} from './Assignee.js';
import {TagUI} from './Tag.js';
import {getSettingsState} from '../state/settings.state.js';

type Props = {
	width: number;
};

export const Breadcrumb: React.FC<Props> = ({width}) => {
	const {viewMode} = getSettingsState();
	const state = useAppState();

	const {
		breadCrumb: crumbs,
		contextNode,
		selectedIndex,
		renderedChildrenIndex,
	} = state;

	const selectedTarget = renderedChildrenIndex[contextNode.id]?.[selectedIndex];

	const ticketResult = findAncestor(
		selectedTarget?.id ?? contextNode.id,
		'TICKET',
	);
	const ticket = isSuccess(ticketResult) ? ticketResult.value : undefined;

	const tags = ticket?.props.tags ?? [];
	const assignees = ticket?.props.assignees ?? [];

	const showDetails = ticket?.parentNodeId
		? !isDescendantOf(contextNode.id, ticket.parentNodeId) &&
		  viewMode === 'dense'
		: false;

	const breadcrumbString = crumbs
		.map((b, i) => {
			const isLast = i === crumbs.length - 1;
			const children = getOrderedChildren(b.id);
			const selectedChildTitle = isLast
				? children?.[selectedIndex]?.title
				: undefined;

			return `${i ? ' / ' : ''}${b.title ?? ''}${
				selectedChildTitle ? ` ▸ ${selectedChildTitle}` : ''
			}`;
		})
		.join('');

	// Reserve width for metadata pills
	const estimatedTagWidth =
		tags.reduce(
			(sum, tag) => sum + (nodeRepo.getTag(tag)?.name.length ?? 0) + 4,
			0,
		) +
		assignees.reduce(
			(sum, assignee) =>
				sum + (nodeRepo.getContributor(assignee)?.name.length ?? 0) + 4,
			0,
		);

	const breadcrumbWidth = width - estimatedTagWidth;

	return (
		<Box overflow="hidden" justifyContent="flex-start" alignItems="flex-start">
			<Box overflow="hidden" width={breadcrumbWidth}>
				<Text wrap={'truncate-end'} color={theme.secondary2}>
					{breadcrumbString}
				</Text>
			</Box>

			{showDetails
				? tags.map(tag => (
						<Box key={tag} paddingLeft={1}>
							<TagUI id={tag} />
						</Box>
				  ))
				: null}

			{showDetails
				? assignees.map(assignee => (
						<Box key={assignee} paddingLeft={1}>
							<AssigneeUI id={assignee} />
						</Box>
				  ))
				: null}
		</Box>
	);
};
