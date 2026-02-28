import React from 'react';
import {Box, Text} from 'ink';
import {appState} from '../state/state.js';
import {theme} from '../theme/themes.js';

export const Breadcrumb: React.FC = () => {
	const crumbs = appState.breadCrumb;
	const lastIndex = crumbs.length - 1;

	return (
		<Box>
			{crumbs.map((b, i) => {
				const isLast = i === lastIndex;

				// Only the last crumb level should use the current selectedIndex
				const selectedChildTitle = isLast
					? b.children?.[appState.selectedIndex]?.fields?.['title']
					: undefined;

				return (
					<Box key={`${b.id ?? i}-${i}`}>
						<Text color={theme.secondary}>{i ? ' / ' : ''}</Text>

						<Text color={theme.secondary}>{b.fields?.['title'] ?? ''}</Text>

						{selectedChildTitle ? (
							<Text color={theme.primary}>{` ⸬ ${selectedChildTitle}`}</Text>
						) : null}
					</Box>
				);
			})}
		</Box>
	);
};
