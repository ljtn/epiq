import {cmdCompletions as completions} from './auto-completion-commands.js';
import {
	CmdKeyword,
	CmdKeywords,
	CmdValidity,
	cmdValidity,
	DefaultCmdModifier,
} from './command-types.js';

// Types
type ValidationResult = {
	validity: CmdValidity;
	message?: string;
};
type Validator = (modifier: DefaultCmdModifier | string) => ValidationResult;

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
	postFix: string = '',
) =>
	`${prefix}${pickRandom(wordList, 2)
		.map(word => `"${word}"`)
		.join(' or ')}${postFix}`;
const alwaysSucceed: Validator = () => valid();

const requireExact =
	(expected: string): Validator =>
	modifier =>
		modifier === expected
			? valid()
			: invalid(
					isBlank(modifier) ? `to proceed, enter "${expected}"` : undefined,
			  );

const requireOneIn = ({
	list,
	hint,
}: {
	list: readonly string[];
	hint: string;
}): Validator => {
	return modifier =>
		list.includes(modifier)
			? valid()
			: invalid(isBlank(modifier) ? hint : undefined);
};

const validators: Record<CmdKeyword, Validator> = {
	[CmdKeywords.ADD]: alwaysSucceed,
	[CmdKeywords.HELP]: alwaysSucceed,
	[CmdKeywords.RENAME]: alwaysSucceed,
	[CmdKeywords.DELETE]: requireExact(completions[CmdKeywords.DELETE][0]!),
	[CmdKeywords.VIEW]: requireOneIn({
		list: completions[CmdKeywords.VIEW],
		hint: buildOptionsHint('', completions[CmdKeywords.VIEW]),
	}),
	[CmdKeywords.TAG]: requireOneIn({
		list: completions[CmdKeywords.TAG],
		hint: buildOptionsHint(
			' tag like ',
			completions[CmdKeywords.TAG],
			', etc.',
		),
	}),
	[CmdKeywords.ASSIGN]: requireOneIn({
		list: completions[CmdKeywords.ASSIGN],
		hint: buildOptionsHint(
			' username like ',
			completions[CmdKeywords.ASSIGN],
			', etc.',
		),
	}),
};

export const CmdValidation: Record<
	CmdKeyword,
	{
		validate: (
			command: CmdKeyword,
			modifier: DefaultCmdModifier | string,
		) => ValidationResult;
	}
> = Object.fromEntries(
	Object.entries(validators).map(([command, validate]) => [
		command,
		{
			validate: (_command, modifier) => validate(modifier.trim()),
		},
	]),
) as Record<
	CmdKeyword,
	{
		validate: (
			command: CmdKeyword,
			modifier: DefaultCmdModifier | string,
		) => ValidationResult;
	}
>;
