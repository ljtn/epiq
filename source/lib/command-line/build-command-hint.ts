import chalk from 'chalk';
import {getGradientWord, getWordGradientPosition} from '../utils/color.js';
import {theme} from '../theme/themes.js';

export const hintDefault = (value: string) => chalk.dim(value);
export const hintAlert = (value: string) => chalk.hex(theme.primary)(value);
export const buildOptionsHint = ({
	prefix = '',
	wordList,
	postfix = '',
	noOfHints = 100,
	inputString,
	minLengthForHints = 1,
}: {
	prefix?: string;
	wordList: readonly string[];
	postfix?: string;
	noOfHints?: number;
	inputString: string;
	minLengthForHints?: number;
}) => {
	const trimmedInput = inputString.trim();

	if (trimmedInput.length < minLengthForHints) {
		return '';
	}

	const filteredList = wordList
		.filter(Boolean)
		.filter(x => x.startsWith(trimmedInput));

	const sortedByGradient = [...filteredList].sort(
		(a, b) => getWordGradientPosition(a) - getWordGradientPosition(b),
	);

	const hintOptions = sortedByGradient.slice(0, noOfHints);

	const coloredOptions = hintOptions
		.map(word => getGradientWord(word))
		.join(' ');

	return coloredOptions
		? `${hintDefault(prefix)}${coloredOptions}${hintDefault(postfix)}`
		: '';
};
