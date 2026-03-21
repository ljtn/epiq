import {getCmdModifiers} from './command-modifiers.js';
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
	inputString,
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
	wordList.length
		? `${prefix}${pickRandom(wordList, noOfHints)
				.map(word => `"${word}"`)
				.join(' or ')}${postfix}`
		: '';

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

const requireModifierOrInputStr =
	({hint}: {hint: string}): Validator =>
	({modifier, inputString}) => {
		return isBlank(modifier) && isBlank(inputString) ? invalid(hint) : valid();
	};

const getList = (command: CmdKeyword): string[] => getCmdModifiers()[command];

const validators: Record<CmdKeyword, Validator> = {
	[CmdKeywords.NEW]: args =>
		requireOneIn({
			list: getList(CmdKeywords.NEW),
			hint: buildOptionsHint('', getList(CmdKeywords.NEW), '', 3),
		})(args),
	[CmdKeywords.HELP]: alwaysSucceed,
	[CmdKeywords.RENAME]: alwaysSucceed,
	[CmdKeywords.DELETE]: args =>
		requireExact(getList(CmdKeywords.DELETE)[0] ?? 'confirm')(args),
	[CmdKeywords.VIEW]: args =>
		requireOneIn({
			list: getList(CmdKeywords.VIEW),
			hint: buildOptionsHint('', getList(CmdKeywords.VIEW)),
		})(args),
	[CmdKeywords.TAG]: args =>
		requireModifierOrInputStr({
			hint: buildOptionsHint(
				'provide tag name like ',
				getList(CmdKeywords.TAG),
				', etc.',
			),
		})(args),
	[CmdKeywords.ASSIGN]: args =>
		requireModifierOrInputStr({
			hint: buildOptionsHint(
				'provide user name like ',
				getList(CmdKeywords.ASSIGN),
				', etc.',
			),
		})(args),
};

type CmdValidator = {
	validate: (
		command: CmdKeyword,
		modifier: string,
		inputString: string,
	) => ValidationResult;
};

type CmdValidation = Record<CmdKeyword, CmdValidator>;

export const cmdValidation: CmdValidation = Object.fromEntries(
	Object.entries(validators).map(([command, validate]) => [
		command,
		{
			validate: (cmd, modifier, inputString) =>
				validate({modifier, command: cmd, inputString}),
		},
	]),
) as CmdValidation;
