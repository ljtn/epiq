import {Box, Text} from 'ink';
import React from 'react';
import {Mode} from '../model/action-map.model.js';
import {getState} from '../state/state.js';
import {theme} from '../theme/themes.js';

export const HelpUI: React.FC<{width: number}> = ({width}) => {
	const arr = [...getState().availableActions]
		.map(action => action.description)
		.filter(description => description !== undefined)
		.map(desc => {
			const [leftRaw, rightRaw] = desc!.split(']');
			const left = leftRaw?.replace('[', '');
			const right = rightRaw?.trim(); // no extra space
			return [left, right];
		})
		.filter(
			(entry): entry is [string, string] =>
				entry[0] !== undefined && entry[1] !== undefined,
		)
		.sort(([a], [b]) => {
			if (a.length === 1 && b.length !== 1) return -1;
			if (a.length !== 1 && b.length === 1) return 1;
			return a.localeCompare(b, undefined, {sensitivity: 'base'});
		});

	arr.unshift(['Key(s)', 'Action']);

	return (
		<Box
			flexDirection="column"
			marginTop={3}
			borderColor={theme.secondary}
			borderStyle="round"
			width={width}
			minHeight={19}
		>
			<Box flexDirection="column" width={width}>
				{getState().mode === Mode.HELP
					? arr.map(([left, right], index) => {
							return (
								<Box paddingLeft={1} key={index} flexDirection="row">
									<Box
										key={index}
										flexDirection="row"
										paddingBottom={index ? 0 : 1}
									>
										<Box width={20} justifyContent="flex-end">
											<Text color={index ? theme.accent : theme.secondary}>
												{left}
											</Text>
										</Box>
										<Box flexGrow={1} width={40} paddingLeft={2}>
											<Text color={index ? theme.primary : theme.secondary}>
												{right}
											</Text>
										</Box>
									</Box>
								</Box>
							);
					  })
					: null}
			</Box>
		</Box>
	);
};
