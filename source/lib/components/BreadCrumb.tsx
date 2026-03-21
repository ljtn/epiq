import {Box, Text} from 'ink';
import React from 'react';
import {Ticket} from '../model/context.model.js';
import {getState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {TagUI} from './Tag.js';
import {getTicketFields} from './TicketListItem.js';
import {AssigneeUI} from './Assignee.js';

export const Breadcrumb: React.FC = () => {
	const {breadCrumb: crumbs, selectedIndex, viewMode} = getState();
	const lastIndex = crumbs.length - 1;
	const last = crumbs.at(-1)?.children[selectedIndex];

	const fields = getTicketFields(last as Ticket);
	const tags = fields['Tags']?.values ?? [];
	const assignees = fields['Assignees']?.values ?? [];

	return (
		<Box>
			{crumbs.map((b, i) => {
				const isLast = i === lastIndex;

				const selectedChildTitle = isLast
					? b.children?.[selectedIndex]?.name
					: undefined;

				return (
					<Box key={`${b.id ?? i}-${i}`}>
						<Text color={theme.secondary}>{i ? ' / ' : ''}</Text>
						<Text color={theme.secondary}>{b.name ?? ''}</Text>

						{selectedChildTitle ? (
							<Text color={theme.primary}>{` ⸬ ${selectedChildTitle}`}</Text>
						) : null}

						{viewMode === 'dense' && isLast && tags.length > 0
							? tags.map(tag => (
									<Box key={`${tag}`} paddingLeft={2}>
										<TagUI name={tag} />
									</Box>
							  ))
							: null}
						{viewMode === 'dense' && isLast && assignees.length > 0
							? assignees.map(assignee => (
									<Box key={`${assignee}`} paddingLeft={2}>
										<AssigneeUI name={assignee} />
									</Box>
							  ))
							: null}
					</Box>
				);
			})}
		</Box>
	);
};
