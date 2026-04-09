import {Box, Text} from 'ink';
import React from 'react';
import {findAncestor, isDescendantOf} from '../../repository/node-repo.js';
import {getOrderedChildren} from '../../repository/rank.js';
import {getState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {AssigneeUI} from './Assignee.js';
import {TagUI} from './Tag.js';
import {isSuccess} from '../command-line/command-types.js';

export const Breadcrumb: React.FC = () => {
	const {breadCrumb: crumbs, currentNode, selectedIndex, viewMode} = getState();

	const selectedTarget = getOrderedChildren(currentNode.id)[selectedIndex];
	const ticketResult = findAncestor(
		selectedTarget?.id ?? currentNode.id,
		'TICKET',
	);
	const ticket = isSuccess(ticketResult) ? ticketResult.data : undefined;

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
	return (
		<Box>
			{crumbs.map((b, i) => {
				const isLast = i === crumbs.length - 1;
				const children = getOrderedChildren(b.id);
				const selectedChildTitle = isLast
					? children?.[selectedIndex]?.title
					: undefined;

				return (
					<Box key={`${b.id}-${i}`}>
						<Text color={theme.secondary}>{i ? ' / ' : ''}</Text>
						<Text color={theme.secondary}>{b.title ?? ''}</Text>

						{selectedChildTitle ? (
							<Text color={theme.primary}>{` ▸ ${selectedChildTitle}`}</Text>
						) : null}

						{showDetails && isLast
							? tags.map(tagId => (
									<Box key={tagId} paddingLeft={2}>
										<TagUI id={tagId} />
									</Box>
							  ))
							: null}

						{showDetails && isLast
							? assignees.map(assigneeId => (
									<Box key={assigneeId} paddingLeft={2}>
										<AssigneeUI id={assigneeId} />
									</Box>
							  ))
							: null}
					</Box>
				);
			})}
		</Box>
	);
};
