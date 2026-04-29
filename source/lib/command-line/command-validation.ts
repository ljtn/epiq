import chalk from 'chalk';
import {safeDateFromUlid} from '../../event/date-utils.js';
import {nodeRepo} from '../../repository/node-repo.js';
import {Filter, findInBreadCrumb} from '../model/app-state.model.js';
import {getState} from '../state/state.js';
import {
	getGradientWord,
	getStringColor,
	getWordGradientPosition,
} from '../utils/color.js';
import {getCmdModifiers} from './command-modifiers.js';
import {
	CmdKeyword,
	CmdKeywords,
	CmdValidity,
	cmdValidity,
	isFail,
} from './command-types.js';
import {isDateWithinPeekHorizon, parsePeekDateInput} from './validate-date.js';
import {AnyContext} from '../model/context.model.js';

const EDITABLE_NODES: AnyContext[] = ['BOARD', 'TICKET', 'SWIMLANE'];

const guardEditableNodes = (): ValidationResult => {
	const target = getState().selectedNode;
	if (!target?.context)
		return invalid({
			message: 'Missing target context',
			completionWordList: [],
		});

	if (!EDITABLE_NODES.includes(target?.context)) {
		return invalid({
			message: 'Command not available in this context',
			completionWordList: [],
		});
	}
	return valid();
};

export const CONFIRM_MSG = '<ENTER> to confirm';

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
const valid = (
	message: string = '',
	completionWordList: string[] = [],
): ValidationResult => ({
	message,
	validity: cmdValidity.Valid,
	completionWordList,
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

const buildHint = ({
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
	const filteredList = wordList
		.filter(Boolean)
		.filter(x => x.startsWith(inputString.trim()));

	const sortedByGradient = [...filteredList].sort(
		(a, b) => getWordGradientPosition(a) - getWordGradientPosition(b),
	);

	const hintOptions = sortedByGradient.slice(0, noOfHints).map(getGradientWord);

	const optionsStr =
		hintOptions.length > minLengthForHints ? hintOptions.join(' ') : '';
	return optionsStr ? `${prefix}${optionsStr}${postfix}` : '';
};

const requireExact = ({modifier}: {modifier: string}) => {
	const expected = 'confirm';
	return modifier === expected
		? valid(CONFIRM_MSG)
		: invalid({
				message: isBlank(modifier)
					? `if you are certain, enter ${getGradientWord(expected)}`
					: '',
				completionWordList: [expected],
		  });
};

const requireOneIn =
	({list, hint}: {list: readonly string[]; hint: string}): Validator =>
	({modifier}) =>
		list.includes(modifier)
			? valid(CONFIRM_MSG)
			: invalid({
					message: isBlank(modifier) ? hint : '',
					completionWordList: [],
			  });

const requireOneWithValueIn =
	({
		list,
		hint,
		onValue,
	}: {
		list: readonly string[];
		hint: string;
		onValue: string;
	}): Validator =>
	({modifier, inputString}) => {
		if (!list.includes(modifier)) {
			return invalid({
				message: isBlank(modifier) ? hint : '',
				completionWordList: [],
			});
		}

		if (inputString.trim().length < 1) {
			return invalid({
				message: onValue,
				completionWordList: [],
			});
		}

		return valid();
	};

const requireModifierOrInputStr =
	({hint}: {hint: string}): Validator =>
	({modifier, inputString}) =>
		isBlank(modifier) && isBlank(inputString)
			? invalid({message: hint, completionWordList: []})
			: valid(CONFIRM_MSG);

const validators: Record<CmdKeyword, Validator> = {
	[CmdKeywords.PEEK]: args => {
		const modifier = args.modifier;
		if (modifier === 'now') return valid(CONFIRM_MSG);

		const hint = {
			message: `historical state from: '1h', '2d', '23h', '1mo', '2y', 'previous', 'next' or full date as YYYY-MM-DD`,
			completionWordList: [],
		};

		if (modifier === 'prev') return valid(CONFIRM_MSG);
		if (modifier === 'next') return valid(CONFIRM_MSG);

		const date = parsePeekDateInput(modifier);

		if (!modifier) return invalid(hint);
		if (!date) return invalid(hint);

		const boardResult = findInBreadCrumb(getState().breadCrumb, 'BOARD');

		if (isFail(boardResult)) {
			return invalid({
				message: 'Command is not applicable in this context',
				completionWordList: [],
			});
		}
		const boardCreationDate = safeDateFromUlid(boardResult.data.id);

		if (isFail(boardCreationDate)) {
			return invalid({
				message: 'Unable to peek: board id is not a valid ULID',
				completionWordList: [],
			});
		}

		if (
			!isDateWithinPeekHorizon({
				date,
				horizonDate: boardCreationDate.data,
			})
		) {
			return invalid({
				message: chalk.red(
					`nothing to peek before ${boardCreationDate.data
						.toISOString()
						.slice(0, 16)
						.replace('T', ' ')}`,
				),
				completionWordList: [],
			});
		}

		return valid(CONFIRM_MSG);
	},
	[CmdKeywords.INIT]: () => valid(CONFIRM_MSG),
	[CmdKeywords.FILTER]: args => {
		if (args.modifier === 'clear') return valid();

		const isValidModifier = (val: string): val is Filter['target'] =>
			getCmdModifiers(CmdKeywords.FILTER).includes(val);

		const modifier = args.modifier;
		if (!modifier || !isValidModifier(args.modifier ?? '')) {
			return invalid({
				message: buildHint({
					wordList: getCmdModifiers(CmdKeywords.FILTER),
					inputString: args.inputString,
				}),
				completionWordList: getCmdModifiers(CmdKeywords.FILTER),
			});
		}

		const tags = Object.values(getState().tags).map(x => x.name);
		const contributors = Object.values(getState().contributors).map(
			x => x.name,
		);

		const wordList =
			args.modifier === 'tag'
				? tags
				: args.modifier === 'assignee'
				? contributors
				: [];

		if (!args.inputString) {
			return invalid({
				message: buildHint({
					prefix: `one of... `,
					wordList,
					noOfHints: 10,
					inputString: args.inputString,
				}),
				completionWordList: wordList,
			});
		}

		if (wordList.length && !wordList.includes(args.inputString.trim() ?? '')) {
			return invalid({
				message: buildHint({
					prefix: `existing ${args.modifier}s... `,
					wordList,
					noOfHints: 10,
					inputString: args.inputString,
				}),
				completionWordList: wordList,
			});
		}

		return valid();
	},

	[CmdKeywords.NONE]: args => {
		return !args.command
			? invalid({
					message: buildHint({
						prefix: 'commands... ',
						wordList: getCmdModifiers(CmdKeywords.NONE),
						inputString: args.inputString,
						minLengthForHints: 0,
					}),
					completionWordList: [],
			  })
			: valid();
	},

	[CmdKeywords.NEW]: args =>
		requireOneWithValueIn({
			list: getCmdModifiers(CmdKeywords.NEW),
			hint: buildHint({
				wordList: getCmdModifiers(CmdKeywords.NEW),
				noOfHints: 3,
				inputString: args.inputString,
				minLengthForHints: 0,
			}),
			onValue: 'provide a name...',
		})(args),

	[CmdKeywords.SET_DESCRIPTION]: () => valid(CONFIRM_MSG),
	[CmdKeywords.HELP]: () => valid(CONFIRM_MSG),
	[CmdKeywords.RENAME]: () => {
		const editableNodeTypeValidation = guardEditableNodes();
		if (editableNodeTypeValidation.validity === 'invalid')
			return editableNodeTypeValidation;
		return valid(CONFIRM_MSG);
	},
	[CmdKeywords.DELETE]: args => {
		const editableNodeTypeValidation = guardEditableNodes();
		if (editableNodeTypeValidation.validity === 'invalid')
			return editableNodeTypeValidation;
		return requireExact(args);
	},
	[CmdKeywords.CLOSE_ISSUE]: args => requireExact(args),
	[CmdKeywords.RE_OPEN_ISSUE]: args => requireExact(args),

	[CmdKeywords.MOVE]: args => {
		const editableNodeTypeValidation = guardEditableNodes();
		if (editableNodeTypeValidation.validity === 'invalid')
			return editableNodeTypeValidation;

		return requireModifierOrInputStr({
			hint: buildHint({
				prefix: 'hey hacker! These commands are blocked for you... ',
				wordList: getCmdModifiers(CmdKeywords.MOVE),
				noOfHints: 10,
				inputString: args.inputString,
			}),
		})(args);
	},

	[CmdKeywords.TAG]: args => {
		const tags = nodeRepo
			.getExistingTags()
			.map(tag => ` ${chalk.bgHex(getStringColor(tag))(' ' + tag + ' ')} `)
			.slice(0, 10);

		return requireModifierOrInputStr({
			hint: 'tag name like... ' + tags.join(''),
		})(args);
	},

	[CmdKeywords.ASSIGN]: args => {
		const contributors = nodeRepo
			.getExistingAssignees()
			.map(
				assignee =>
					` ${chalk.bgHex(getStringColor(assignee))(' ' + assignee + ' ')} `,
			)
			.slice(0, 10);

		return requireModifierOrInputStr({
			hint: 'assign to... ' + contributors.join(''),
		})(args);
	},

	// Settings
	[CmdKeywords.SET_EDITOR]: args => {
		logger.debug(
			`Validating command: ${args.command} ${args.modifier} ${args.inputString}`,
		);
		const wordList = getCmdModifiers(CmdKeywords.SET_EDITOR);

		return !args.modifier
			? invalid({
					message: buildHint({
						wordList,
						inputString: args.inputString,
					}),
					completionWordList: [],
			  })
			: valid(CONFIRM_MSG);
	},

	[CmdKeywords.SET_USERNAME]: args => {
		return !args.inputString
			? invalid({
					message: `Enter a username. Saved in ${chalk.bgBlack('~/.epiq/')}`,
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
	[CmdKeywords.SYNC]: () => valid(CONFIRM_MSG),
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
