import {Box, Text} from 'ink';
import React from 'react';
import {Ticket} from '../model/context.model.js';
import {getState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import {getTicketFields} from './TicketListItem.js';
import {TagUI} from './Tag.js';

export const Breadcrumb: React.FC = () => {
	const {breadCrumb: crumbs, selectedIndex, viewMode} = getState();
	const lastIndex = crumbs.length - 1;
	const last = crumbs.at(-1)?.children[selectedIndex];

	const fields = getTicketFields(last as Ticket);
	const tags = fields['Tags']?.values ?? [];

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
							? tags.map((tag, tagIndex) => (
									<Box key={`${tag}-${tagIndex}`} paddingLeft={2}>
										<TagUI name={tag} />
									</Box>
							  ))
							: null}
					</Box>
				);
			})}
		</Box>
	);
};
