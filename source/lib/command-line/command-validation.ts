import chalk from 'chalk';
import {Filter} from '../model/app-state.model.js';
import {getState} from '../state/state.js';
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
	completionWordList: string[];
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
const valid = (): ValidationResult => ({
	validity: cmdValidity.Valid,
	completionWordList: [],
});
const invalid = ({
	message,
	completionWordList,
}: {
	message: string;
	completionWordList: string[];
}): ValidationResult => ({
	validity: cmdValidity.Invalid,
	message,
	completionWordList,
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

const buildHint = ({
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

	const highlight = (word: string) =>
		`${chalk.dim.bgBlack.white(' ' + word + ' ')}`;

	const hintOptions = pickRandom(filteredList ?? [], noOfHints).map(highlight);

	return filteredList.length
		? `${prefix}${
				hintOptions.length > 1 ? hintOptions.join(' ') : ''
		  }${postfix}`
		: '';
};

const alwaysSucceed: Validator = () => valid();

const requireExact =
	(expected: string): Validator =>
	({modifier}) =>
		modifier === expected
			? valid()
			: invalid({
					message: isBlank(modifier)
						? `if you are certain, enter ${chalk.dim.bgBlack.white(
								' ' + expected + ' ',
						  )}`
						: '',
					completionWordList: [],
			  });

const requireOneIn =
	({list, hint}: {list: readonly string[]; hint: string}): Validator =>
	({modifier}) =>
		list.includes(modifier)
			? valid()
			: invalid({
					message: isBlank(modifier) ? hint : '',
					completionWordList: [],
			  });

const requireModifierOrInputStr =
	({hint}: {hint: string}): Validator =>
	({modifier, inputString}) => {
		return isBlank(modifier) && isBlank(inputString)
			? invalid({message: hint, completionWordList: []})
			: valid();
	};

const validators: Record<CmdKeyword, Validator> = {
	[CmdKeywords.FILTER]: args => {
		const modifier = args.modifier;
		if (!modifier) {
			return invalid({
				message: buildHint({
					wordList: getCmdModifiers(CmdKeywords.FILTER),
					noOfHints: 100,
					inputString: args.inputString,
				}),
				completionWordList: getCmdModifiers(CmdKeywords.FILTER),
			});
		}

		const regex = /(!=|=)/;
		const [filterTarget, _filterOperator, filterValue] = modifier.split(regex);

		const isValidModifier = (val: string): val is Filter['target'] =>
			getCmdModifiers(CmdKeywords.FILTER)
				.map(x => x.replace(/(!=|=).*/, ''))
				.includes(val);

		if (!isValidModifier(filterValue ?? '')) {
			const tags = Object.values(getState().tags).map(x => x.name);
			const contributors = Object.values(getState().contributors).map(
				x => x.name,
			);
			const wordList =
				filterTarget === 'tag'
					? tags
					: filterTarget === 'assignee'
					? contributors
					: [];

			if (!wordList.includes(filterValue ?? ''))
				return invalid({
					message: buildHint({
						wordList,
						noOfHints: 100,
						inputString: args.inputString,
					}),
					completionWordList: wordList,
				});
		}

		return valid();
	},
	[CmdKeywords.NONE]: args => {
		const list = getCmdModifiers(CmdKeywords.NONE);
		return !args.command
			? invalid({
					message: buildHint({
						wordList: list,
						noOfHints: 100,
						inputString: args.inputString,
					}),
					completionWordList: [],
			  })
			: valid();
	},
	[CmdKeywords.NEW]: args =>
		requireOneIn({
			list: getCmdModifiers(CmdKeywords.NEW),
			hint: buildHint({
				wordList: getCmdModifiers(CmdKeywords.NEW),
				noOfHints: 3,
				inputString: args.inputString,
			}),
		})(args),
	[CmdKeywords.HELP]: alwaysSucceed,
	[CmdKeywords.RENAME]: alwaysSucceed,
	[CmdKeywords.DELETE]: args =>
		requireExact(getCmdModifiers(CmdKeywords.DELETE)[0] ?? 'confirm')(args),
	[CmdKeywords.TAG]: args =>
		requireModifierOrInputStr({
			hint: buildHint({
				prefix: 'provide tag name like: ',
				wordList: getCmdModifiers(CmdKeywords.TAG),
				postfix: ', etc.',
				noOfHints: 3,
				inputString: args.inputString,
			}),
		})(args),
	[CmdKeywords.ASSIGN]: args =>
		requireModifierOrInputStr({
			hint: buildHint({
				wordList: getCmdModifiers(CmdKeywords.ASSIGN),
				postfix: ', etc.',
				noOfHints: 3,
				inputString: args.inputString,
			}),
		})(args),

	// Settings
	[CmdKeywords.SET_EDITOR]: args => {
		const wordList = getCmdModifiers(CmdKeywords.SET_EDITOR);

		return !args.modifier
			? invalid({
					message: buildHint({
						wordList,
						noOfHints: 100,
						inputString: args.inputString,
					}),
					completionWordList: [],
			  })
			: valid();
	},
	[CmdKeywords.SET_USERNAME]: args => {
		return !args.inputString
			? invalid({
					message: 'Provide a global name (unique for consistent event logs)',
					completionWordList: [],
			  })
			: valid();
	},
	[CmdKeywords.SET_VIEW]: args =>
		requireOneIn({
			list: getCmdModifiers(CmdKeywords.SET_VIEW),
			hint: buildHint({
				wordList: getCmdModifiers(CmdKeywords.SET_VIEW),
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
