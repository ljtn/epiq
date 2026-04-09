import {Text} from 'ink';
import React, {useEffect, useState} from 'react';
import {theme} from '../theme/themes.js';

type Props = {
	isSelected: boolean;
	placeholder?: string;
};

export const CursorUI: React.FC<Props> = ({isSelected, placeholder = '  '}) => {
	const frames = ['▸ ', '▸ ', '▸ '];
	// const frames = ['⸬ ', '⸭ ', '⸬ '];
	// const frames = ['⸬ ', '⸬ ', '⸬ '];
	const [frameIndex, setFrameIndex] = useState(frames.length - 1);

	useEffect(() => {
		if (!isSelected) return;

		const interval = setInterval(() => {
			setFrameIndex(v => (v + 1) % frames.length);
		}, 800);

		return () => clearInterval(interval);
	}, [isSelected]);

	if (!isSelected) {
		return <Text>{placeholder}</Text>;
	}

	return (
		<Text color={theme.accent} dimColor={frameIndex === 1}>
			{frames[frameIndex]}
		</Text>
	);
};
