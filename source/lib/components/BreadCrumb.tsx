import {Box, Text} from 'ink';
import React from 'react';
import {findAncestor, isDescendantOf} from '../repository/node-repo.js';
import {getOrderedChildren} from '../repository/node-repo.js';
import {getState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {AssigneeUI} from './Assignee.js';
import {TagUI} from './Tag.js';
import {isSuccess} from '../model/result-types.js';

type Props = {
	width: number;
};

const truncate = (str: string, max: number) => {
	if (str.length <= max) return str;
	if (max <= 1) return '…';
	return str.slice(0, max - 1) + '…';
};

export const Breadcrumb: React.FC<Props> = ({width}) => {
	const {breadCrumb: crumbs, currentNode, selectedIndex, viewMode} = getState();

	const selectedTarget = getOrderedChildren(currentNode.id)[selectedIndex];
	const ticketResult = findAncestor(
		selectedTarget?.id ?? currentNode.id,
		'TICKET',
	);
	const ticket = isSuccess(ticketResult) ? ticketResult.value : undefined;

	const ticketChildren = ticket?.id ? getOrderedChildren(ticket.id) : [];

	const getReferencedIds = (title: 'Tags' | 'Assignees') => {
		const fieldNode = ticketChildren.find(node => node.title === title);
		if (!fieldNode) return [];

		return getOrderedChildren(fieldNode.id)
			.map(node =>
				typeof node.props?.value === 'string' ? node.props.value : '',
			)
			.filter((value): value is string => Boolean(value));
	};

	const tags = getReferencedIds('Tags');
	const assignees = getReferencedIds('Assignees');

	const showDetails = ticket?.parentNodeId
		? !isDescendantOf(currentNode.id, ticket?.parentNodeId) &&
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
				? tags.map(tagId => (
						<Box key={tagId} paddingLeft={2}>
							<TagUI id={tagId} />
						</Box>
				  ))
				: null}

			{showDetails
				? assignees.map(assigneeId => (
						<Box key={assigneeId} paddingLeft={2}>
							<AssigneeUI id={assigneeId} />
						</Box>
				  ))
				: null}
		</Box>
	);
};
