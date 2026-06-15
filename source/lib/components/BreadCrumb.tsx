import {Box, Text} from 'ink';
import React from 'react';
import {isSuccess} from '../model/result-types.js';
import {
	findAncestor,
	isDescendantOf,
	nodeRepo,
} from '../repository/node-repo.js';
import {getOrderedChildren} from '../repository/rank.js';
import {getSettingsState} from '../state/settings.state.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {AssigneeUI} from './Assignee.js';
import {TagUI} from './Tag.js';

type Props = {
	width: number;
};

const getTagCharacterLength = (tagId: string): number => {
	const name = nodeRepo.getTag(tagId)?.name ?? '';
	return name.length + 3; // paddingLeft={1} + TagUI pill decoration estimate
};

const getAssigneeCharacterLength = (assigneeId: string): number => {
	const name = nodeRepo.getContributor(assigneeId)?.name ?? '';
	return name.length + 3; // paddingLeft={1} + AssigneeUI pill decoration estimate
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

	const comments = ticket ? nodeRepo.getCommentsByIssue(ticket.id) : [];
	const commentCharacterLength = comments.length
		? String(comments.length).length + 11 // " [3 comments]"
		: 0;

	const pillCharacterLength = showDetails
		? tags.reduce((sum, tag) => sum + getTagCharacterLength(tag), 0) +
		  assignees.reduce(
				(sum, assignee) => sum + getAssigneeCharacterLength(assignee),
				0,
		  ) +
		  commentCharacterLength
		: 0;

	const maxBreadcrumbWidth = Math.max(0, width - pillCharacterLength);
	const breadcrumbText = breadcrumbString.substring(0, maxBreadcrumbWidth);

	const pills = showDetails
		? [
				...tags.map(tag => (
					<Box key={`tag-${tag}`} paddingLeft={1}>
						<TagUI id={tag} />
					</Box>
				)),
				...assignees.map(assignee => (
					<Box key={`assignee-${assignee}`} paddingLeft={1}>
						<AssigneeUI id={assignee} />
					</Box>
				)),
				comments.length ? (
					<Box key="comments" paddingLeft={1}>
						<Text color={theme.accent}>
							[{comments.length} comment{comments.length === 1 ? '' : 's'}]
						</Text>
					</Box>
				) : null,
		  ]
		: [];

	return (
		<Box overflow="hidden" justifyContent="flex-start" alignItems="flex-start">
			<Text color={theme.secondary2}>{breadcrumbText}</Text>

			{pills}
		</Box>
	);
};
