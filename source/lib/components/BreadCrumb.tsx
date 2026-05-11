import {Box, Text} from 'ink';
import React from 'react';
import {findAncestor, isDescendantOf} from '../repository/node-repo.js';
import {getOrderedChildren} from '../repository/rank.js';
import {getState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {AssigneeUI} from './Assignee.js';
import {TagUI} from './Tag.js';
import {isSuccess} from '../model/result-types.js';
import {getSettingsState} from '../state/settings.state.js';

type Props = {
	width: number;
};

const truncate = (str: string, max: number) => {
	if (str.length <= max) return str;
	if (max <= 1) return '…';
	return str.slice(0, max - 1) + '…';
};

export const Breadcrumb: React.FC<Props> = ({width}) => {
	const {viewMode} = getSettingsState();
	const {breadCrumb: crumbs, contextNode, selectedIndex} = getState();

	const selectedTarget = getOrderedChildren(contextNode.id)[selectedIndex];
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

	const truncated = truncate(breadcrumbString, width);

	return (
		<Box>
			<Text color={theme.secondary2}>{truncated}</Text>

			{showDetails
				? tags.map(tag => (
						<Box key={tag} paddingLeft={2}>
							<TagUI id={tag} />
						</Box>
				  ))
				: null}

			{showDetails
				? assignees.map(assignee => (
						<Box key={assignee} paddingLeft={2}>
							<AssigneeUI id={assignee} />
						</Box>
				  ))
				: null}
		</Box>
	);
};
