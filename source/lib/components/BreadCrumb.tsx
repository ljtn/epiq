import {Box, Text} from 'ink';
import React from 'react';
import {findInBreadCrumb} from '../model/app-state.model.js';
import {getState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {filterMap} from '../utils/array.utils.js';
import {AssigneeUI} from './Assignee.js';
import {TagUI} from './Tag.js';
import {nodeRepo} from '../actions/add-item/node-repo.js';

export const Breadcrumb: React.FC = () => {
	const {breadCrumb: crumbs, selectedIndex, viewMode, nodes} = getState();
	const ticket = findInBreadCrumb(crumbs, 'TICKET');

	const children = (ticket?.children ?? [])
		.map(id => nodeRepo.getNode(id))
		.filter((node): node is NonNullable<typeof node> => node !== undefined);

	const getListValues = (title: 'Tags' | 'Assignees') =>
		children
			.filter(
				(node): node is typeof node & {props: {value: string[]}} =>
					node.title === title && Array.isArray(node.props.value),
			)
			.flatMap(node => node.props.value);

	const tags = getListValues('Tags');
	const assignees = getListValues('Assignees');

	return (
		<Box>
			{crumbs.map((b, i) => {
				const isLast = i === crumbs.length - 1;
				const children = filterMap(b.children, id => nodes[id]);
				const selectedChildTitle = isLast
					? children?.[selectedIndex]?.title
					: undefined;

				return (
					<Box key={`${b.id ?? i}-${i}`}>
						<Text color={theme.secondary}>{i ? ' / ' : ''}</Text>
						<Text color={theme.secondary}>{b.title ?? ''}</Text>

						{selectedChildTitle ? (
							<Text color={theme.primary}>{` ⸬ ${selectedChildTitle}`}</Text>
						) : null}

						{viewMode === 'dense' && isLast
							? (tags ?? []).map(tagId => (
									<Box key={`${tagId}`} paddingLeft={2}>
										<TagUI id={tagId} />
									</Box>
							  ))
							: null}
						{viewMode === 'dense' && isLast
							? (assignees ?? []).map(assigneeId => (
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
