import {Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {useAppState} from '../state/state.js';
import {theme} from '../theme/themes.js';

type Props = {
	isSelected: boolean;
	placeholder?: string;
};

const cursors = {
	help: ['▸ ', '▸ ', '▸ '],
	default: ['▸ ', '▸ ', '▸ '],
	move: ['↑ ', '→ ', '↓ ', '← '],
	'command-line': ['❯ ', '❯ ', '❯ '],
} as const;

export const CursorUI: React.FC<Props> = ({isSelected, placeholder = '  '}) => {
	const {mode} = useAppState();
	const frames = cursors[mode] ?? cursors.default;

	const [frameIndex, setFrameIndex] = useState(frames.length - 1);

	useEffect(() => {
		if (!isSelected) return;

		const interval = setInterval(() => {
			setFrameIndex(v => (v + 1) % frames.length);
		}, 800);

		return () => clearInterval(interval);
	}, [isSelected, frames]);

	if (!isSelected) {
		return <Text>{placeholder}</Text>;
	}

	return (
		<Text color={theme.accent} dimColor={frameIndex === 1}>
			{frames[frameIndex]}
		</Text>
	);
};
