import {Text} from 'ink';
import React from 'react';
import {theme} from '../theme/themes.js';

type Props = {
	name: string;
	selected?: boolean;
};

type TagColor =
	| 'gray'
	| 'red'
	| 'green'
	| 'yellow'
	| 'blue'
	| 'magenta'
	| 'cyan';

type TagColorRule = {
	color: TagColor;
	words: string[];
};

type TagColorConfig = {
	defaultColor: TagColor;
	rules: TagColorRule[];
};

const TAG_COLOR_CONFIG: TagColorConfig = {
	defaultColor: 'gray',
	rules: [
		{
			color: 'red',
			words: [
				'urgent',
				'critical',
				'important',
				'blocker',
				'asap',
				'immediate',
				'now',
				'fail',
				'failure',
				'broken',
				'bug',
				'error',
				'incident',
				'outage',
				'panic',
				'production',
				'down',
				'crash',
				'security',
			],
		},
		{
			color: 'yellow',
			words: [
				'warning',
				'warn',
				'risky',
				'risk',
				'attention',
				'pending',
				'review',
				'needs-review',
				'qa',
				'testing',
				'test',
				'validate',
				'verification',
				'staging',
				'check',
				'follow-up',
				'followup',
				'waiting',
				'blocked',
				'hold',
			],
		},
		{
			color: 'green',
			words: [
				'done',
				'complete',
				'completed',
				'success',
				'ok',
				'stable',
				'resolved',
				'fixed',
				'closed',
				'merged',
				'released',
				'deployed',
				'approved',
				'verified',
				'working',
				'healthy',
				'pass',
				'passing',
			],
		},
		{
			color: 'blue',
			words: [
				'info',
				'information',
				'note',
				'docs',
				'documentation',
				'doc',
				'guide',
				'help',
				'explanation',
				'detail',
				'details',
				'context',
				'design',
				'discussion',
				'proposal',
				'idea',
			],
		},
		{
			color: 'magenta',
			words: [
				'feature',
				'enhancement',
				'improvement',
				'refactor',
				'refactoring',
				'cleanup',
				'optimize',
				'optimization',
				'perf',
				'performance',
				'upgrade',
				'migration',
				'modernize',
				'tech-debt',
				'debt',
			],
		},
		{
			color: 'cyan',
			words: [
				'todo',
				'next',
				'planned',
				'plan',
				'future',
				'backlog',
				'idea',
				'investigate',
				'explore',
				'prototype',
			],
		},
	],
};

const normalizeTagName = (value: string): string =>
	value.toLowerCase().trim().replace(/\s+/g, ' ');

const tokenizeTagName = (value: string): string[] =>
	normalizeTagName(value)
		.split(/[^a-z0-9]+/i)
		.filter(Boolean);

const getTagBackgroundColor = (
	name: string,
	config: TagColorConfig = TAG_COLOR_CONFIG,
): TagColor => {
	const normalized = normalizeTagName(name);
	const tokens = new Set(tokenizeTagName(normalized));

	for (const rule of config.rules) {
		for (const word of rule.words) {
			const normalizedWord = normalizeTagName(word);

			if (
				normalized === normalizedWord ||
				tokens.has(normalizedWord) ||
				normalized.includes(normalizedWord)
			) {
				return rule.color;
			}
		}
	}

	return config.defaultColor;
};

export const TagUI: React.FC<Props> = ({name}) => {
	const backgroundColor = getTagBackgroundColor(name);

	return (
		<Text backgroundColor={backgroundColor} color={theme.primary}>
			{'' + name + ''}
		</Text>
	);
};
