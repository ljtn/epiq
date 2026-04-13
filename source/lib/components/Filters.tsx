import {Box, Text} from 'ink';
import React from 'react';
import {Filter} from '../model/app-state.model.js';

type Props = {
	filters: Filter[];
};
const FilterUIComponent: React.FC<Props> = ({filters}) => {
	return (
		<Box columnGap={1}>
			<Text color={'red'}>APPLIED FILTERS:</Text>

			{filters.map(({value, target}) => (
				<Text backgroundColor={'black'} color={'white'}>
					{' ' + target + ' = ' + value + ' '}
				</Text>
			))}
		</Box>
	);
};

export const FilterUI = React.memo(FilterUIComponent);
