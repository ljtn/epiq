import chalk from 'chalk';
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

const buildOptionsHint = ({
	prefix = '',
	wordList,
	postfix = '',
	noOfHints = 2,
	inputString,
}: {
	prefix?: string;
	wordList: readonly string[];
	postfix?: string;
	noOfHints: number;
	inputString: string;
}) => {
	const filteredList = wordList
		.filter(Boolean)
		.filter(x => x.startsWith(inputString.trim()));
	return filteredList.length
		? `${prefix}${pickRandom(
				filteredList.length > 1 ? filteredList : [],
				noOfHints,
		  )
				.map(word => `${chalk.dim.bgBlack.white(' ' + word + ' ')}`)
				.join(' ')}${postfix}`
		: '';
};

const alwaysSucceed: Validator = () => valid();

const requireExact =
	(expected: string): Validator =>
	({modifier}) =>
		modifier === expected
			? valid()
			: invalid(
					isBlank(modifier)
						? `if you are certain, enter ${chalk.dim.bgBlack.white(
								' ' + expected + ' ',
						  )}`
						: undefined,
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
	[CmdKeywords.NONE]: args => {
		const list = getList(CmdKeywords.NONE);
		return !args.command
			? invalid(
					buildOptionsHint({
						wordList: list,
						noOfHints: 100,
						inputString: args.inputString,
					}),
			  )
			: valid();
	},
	[CmdKeywords.NEW]: args =>
		requireOneIn({
			list: getList(CmdKeywords.NEW),
			hint: buildOptionsHint({
				wordList: getList(CmdKeywords.NEW),
				noOfHints: 3,
				inputString: args.inputString,
			}),
		})(args),
	[CmdKeywords.HELP]: alwaysSucceed,
	[CmdKeywords.RENAME]: alwaysSucceed,
	[CmdKeywords.DELETE]: args =>
		requireExact(getList(CmdKeywords.DELETE)[0] ?? 'confirm')(args),
	[CmdKeywords.VIEW]: args =>
		requireOneIn({
			list: getList(CmdKeywords.VIEW),
			hint: buildOptionsHint({
				wordList: getList(CmdKeywords.VIEW),
				noOfHints: 3,
				inputString: args.inputString,
			}),
		})(args),
	[CmdKeywords.TAG]: args =>
		requireModifierOrInputStr({
			hint: buildOptionsHint({
				prefix: 'provide tag name like: ',
				wordList: getList(CmdKeywords.TAG),
				postfix: ', etc.',
				noOfHints: 3,
				inputString: args.inputString,
			}),
		})(args),
	[CmdKeywords.ASSIGN]: args =>
		requireModifierOrInputStr({
			hint: buildOptionsHint({
				wordList: getList(CmdKeywords.ASSIGN),
				postfix: ', etc.',
				noOfHints: 3,
				inputString: args.inputString,
			}),
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
			validate: (cmd, modifier, inputString) => {
				return validate({modifier, command: cmd, inputString});
			},
		},
	]),
) as CmdValidation;
