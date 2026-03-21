import {cmdModifiers as completions} from './auto-completion-commands.js';
import {
	CmdKeyword,
	CmdKeywords,
	CmdValidity,
	cmdValidity,
} from './command-types.js';

// Types
type ValidationResult = {
	validity: CmdValidity;
	message?: string;
};
type Validator = ({
	modifier,
	command,
}: {
	modifier: string;
	command: CmdKeyword;
	inputString: string;
}) => ValidationResult;

// Helpers
const valid = (): ValidationResult => ({validity: cmdValidity.Valid});
const invalid = (message?: string): ValidationResult => ({
	validity: cmdValidity.Invalid,
	message,
});
const isBlank = (value: string) => value.length === 0;
const pickRandom = <T>(arr: readonly T[], count: number): T[] => {
	if (arr.length <= count) return [...arr];

	const result: T[] = [];
	const used = new Set<number>();

	while (result.length < count) {
		const i = Math.floor(Math.random() * arr.length);
		if (!used.has(i)) {
			used.add(i);
			result.push(arr[i]!);
		}
	}

	return result;
};
const buildOptionsHint = (
	prefix: string,
	wordList: readonly string[],
	postfix: string = '',
	noOfHints = 2,
) =>
	`${prefix}${pickRandom(wordList, noOfHints)
		.map(word => `"${word}"`)
		.join(' or ')}${postfix}`;
const alwaysSucceed: Validator = () => valid();

const requireExact =
	(expected: string): Validator =>
	({modifier}) =>
		modifier === expected
			? valid()
			: invalid(
					isBlank(modifier) ? `to proceed, enter "${expected}"` : undefined,
			  );

const requireOneIn =
	({list, hint}: {list: readonly string[]; hint: string}): Validator =>
	({modifier}) =>
		list.includes(modifier)
			? valid()
			: invalid(isBlank(modifier) ? hint : undefined);

const requireNonEmptyWithSuggestions =
	({hint}: {hint: string}): Validator =>
	({inputString}) =>
		isBlank(inputString) ? invalid(hint) : valid();

const validators: Record<CmdKeyword, Validator> = {
	[CmdKeywords.NEW]: requireOneIn({
		list: completions[CmdKeywords.NEW],
		hint: buildOptionsHint('', completions[CmdKeywords.NEW], '', 3),
	}),
	[CmdKeywords.HELP]: alwaysSucceed,
	[CmdKeywords.RENAME]: alwaysSucceed,
	[CmdKeywords.DELETE]: requireExact(completions[CmdKeywords.DELETE][0]!),
	[CmdKeywords.VIEW]: requireOneIn({
		list: completions[CmdKeywords.VIEW],
		hint: buildOptionsHint('', completions[CmdKeywords.VIEW]),
	}),

	[CmdKeywords.TAG]: requireNonEmptyWithSuggestions({
		hint: buildOptionsHint(
			'provide tag name like ',
			completions[CmdKeywords.TAG],
			', etc.',
		),
	}),
	[CmdKeywords.ASSIGN]: requireOneIn({
		list: completions[CmdKeywords.ASSIGN],
		hint: buildOptionsHint(
			'provide user name like ',
			completions[CmdKeywords.ASSIGN],
			', etc.',
		),
	}),
};

export const cmdValidation = Object.fromEntries(
	Object.entries(validators).map(([command, validate]) => [
		command,
		{
			validate: (_command, modifier, inputString) =>
				validate({modifier, command: _command, inputString}),
		},
	]),
) as Record<
	CmdKeyword,
	{
		validate: (
			command: CmdKeyword,
			modifier: string,
			inputString: string,
		) => ValidationResult;
	}
>;
