import {Box, Text} from 'ink';
import {safeDateFromUlid} from '../event/date-utils.js';
import {formatDateTime} from '../utils/date.utils.js';
import {isSuccess} from '../model/result-types.js';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';
import React from 'react';

export function PeekStatus() {
	const {eventLog, unappliedEvents} = useAppState();

	const currentEventId = eventLog.at(-1)?.id;
	const currentEventTimeStampResult = safeDateFromUlid(currentEventId ?? '');
	const currentEventTimeStamp = isSuccess(currentEventTimeStampResult)
		? formatDateTime(currentEventTimeStampResult.value)
		: 'INVALID DATE';

	return (
		<Box paddingLeft={1}>
			<Text backgroundColor={theme.accent} color={theme.secondary}>
				{' Readonly '}
			</Text>
			<Text color={theme.accent}>
				{' ' +
					unappliedEvents.length +
					' edits ago at ' +
					currentEventTimeStamp +
					'.'}
			</Text>
			<Text color={theme.accent}> Resume with </Text>
			<Text backgroundColor={theme.accent} color={theme.secondary}>
				{' '}
				:peek now{' '}
			</Text>
		</Box>
	);
}
