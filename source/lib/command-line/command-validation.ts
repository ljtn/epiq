import chalk from 'chalk';
import {
	MIN_AUTOSYNC_DURATION_MS,
	parseAutoSyncDebounceMs,
} from '../../git/auto-sync.js';
import {booleanToYesNo, YesNo} from '../config/setup-utils.js';
import {editorConfig} from '../editor/editor-config.js';
import {safeDateFromUlid} from '../event/date-utils.js';
import {
	BreadCrumb,
	Filter,
	findInBreadCrumb,
} from '../model/app-state.model.js';
import {AnyContext} from '../model/context.model.js';
import {isFail} from '../model/result-types.js';
import {nodeRepo} from '../repository/node-repo.js';
import {getSettingsState} from '../state/settings.state.js';
import {getState} from '../state/state.js';
import {
	getGradientWord,
	getStringColor,
	getWordGradientPosition,
} from '../utils/color.js';
import {
	ticketAssigneesFromBreadCrumb,
	ticketTagsFromBreadCrumb,
} from '../utils/ticket.utils.js';
import {CmdKeyword, CmdKeywords} from './cmd-keywords.js';
import {CmdValidity, cmdValidity} from './cmd-validity.js';
import {
	AUTOSYNC_DEBOUNCE_HINTS,
	ConfigModifiers,
	EditModifiers,
	getCmdModifiers,
} from './command-modifiers.js';
import {isDateWithinPeekHorizon, parsePeekDateInput} from './validate-date.js';

const EDITABLE_NODES: AnyContext[] = ['BOARD', 'TICKET', 'SWIMLANE'];

const guardBoardSwimlaneTicketNodes = (): ValidationResult => {
	const target = getState().selectedNode;
	if (!target?.context) {
		return invalid({
			message: 'Missing target context',
		});
	}

	if (!EDITABLE_NODES.includes(target.context)) {
		return invalid({
			message: 'Command not available in this context',
		});
	}

	return valid();
};

export const CONFIRM_MSG = '<ENTER> to confirm';

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
	completionWordList = [],
}: {
	message: string;
	completionWordList?: string[];
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

	const coloredOptions = hintOptions.map(getGradientWord).join(' ');

	return coloredOptions ? `${prefix}${coloredOptions}${postfix}` : '';
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

// const requireOneIn =
// 	({list, hint}: {list: readonly string[]; hint: string}): Validator =>
// 	({modifier}) =>
// 		list.includes(modifier)
// 			? valid(CONFIRM_MSG)
// 			: invalid({
// 					message: isBlank(modifier) ? hint : '',
// 					completionWordList: [...list],
// 			  });

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
				completionWordList: [...list],
			});
		}

		if (inputString.trim().length < 1) {
			return invalid({
				message: onValue,
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

const validateConfigCommand: Validator = ({modifier, inputString}) => {
	const configModifiers = getCmdModifiers(CmdKeywords.CONFIG);

	if (!configModifiers.includes(modifier)) {
		return invalid({
			message: buildHint({
				prefix: '... ',
				wordList: configModifiers,
				inputString: modifier,
				minLengthForHints: 0,
			}),
			completionWordList: configModifiers,
		});
	}

	switch (modifier) {
		case ConfigModifiers.EDITOR: {
			const wordList = [...editorConfig];

			if (!inputString.trim()) {
				return invalid({
					message: buildHint({
						prefix: 'editors: ',
						wordList,
						inputString,
						minLengthForHints: 0,
					}),
					completionWordList: wordList,
				});
			}

			if (!wordList.includes(inputString.trim())) {
				return invalid({
					message: buildHint({
						prefix: 'editors: ',
						wordList,
						inputString,
						minLengthForHints: 0,
					}),
					completionWordList: wordList,
				});
			}

			return valid(CONFIRM_MSG);
		}

		case ConfigModifiers.VIEW: {
			const wordList = ['dense', 'wide'];

			if (!wordList.includes(inputString.trim())) {
				return invalid({
					message: buildHint({
						prefix: 'view... ',
						wordList,
						inputString,
						minLengthForHints: 0,
					}),
					completionWordList: wordList,
				});
			}

			return valid(CONFIRM_MSG);
		}

		case ConfigModifiers.USERNAME: {
			if (!inputString.trim()) {
				return invalid({
					message: `Enter a user name. Saved in ${chalk.bgBlack(
						'~/.epiq-global/config.json',
					)}`,
				});
			}

			return valid(CONFIRM_MSG);
		}

		case ConfigModifiers.AUTOSYNC: {
			const wordList = ['yes', 'no'] satisfies YesNo[];
			const currentAutoSyncStatus = getSettingsState().autoSync;

			if (!wordList.includes(inputString.trim() as YesNo)) {
				const currentVal = booleanToYesNo(currentAutoSyncStatus);
				return invalid({
					message: buildHint({
						prefix: `should auto-sync (recommended)${
							currentVal !== null ? ', currently: ' + currentVal : ''
						} `,
						wordList,
						noOfHints: 3,
						inputString,
						minLengthForHints: 0,
					}),
					completionWordList: wordList,
				});
			}

			return valid(CONFIRM_MSG);
		}

		case ConfigModifiers.SYNC_DEBOUNCE_MS: {
			const currentDuration = getSettingsState().autoSyncIntervalMs;
			const duration = parseAutoSyncDebounceMs(inputString);

			if (
				!inputString.trim() ||
				duration === null ||
				duration < MIN_AUTOSYNC_DURATION_MS
			) {
				const hint = buildHint({
					prefix: ' examples: ',
					wordList: AUTOSYNC_DEBOUNCE_HINTS,
					minLengthForHints: 0,
					inputString,
				});

				return invalid({
					message:
						`provide duration above ${MIN_AUTOSYNC_DURATION_MS}ms. ` +
						`current duration: ${currentDuration}ms.` +
						hint,
					completionWordList: AUTOSYNC_DEBOUNCE_HINTS,
				});
			}

			return valid(CONFIRM_MSG);
		}

		default:
			return invalid({
				message: 'Unknown config option',
				completionWordList: configModifiers,
			});
	}
};

const validateEditCommand: Validator = ({modifier}) => {
	const editModifiers = getCmdModifiers(CmdKeywords.EDIT);

	if (!editModifiers.includes(modifier)) {
		const message = buildHint({
			prefix: 'edit... ',
			wordList: editModifiers,
			inputString: modifier,
			minLengthForHints: 0,
		});

		return invalid({
			message: message || 'Unknown edit option',
			completionWordList: editModifiers,
		});
	}

	const {breadCrumb, selectedNode} = getState();
	const isTicketInPath = findInBreadCrumb(
		[...breadCrumb, selectedNode] as BreadCrumb,
		'TICKET',
	);
	if (!isTicketInPath)
		return invalid({
			message: 'Command not available in this context',
		});

	switch (modifier) {
		case EditModifiers.TITLE:
			return valid(CONFIRM_MSG);

		case EditModifiers.DESCRIPTION:
			return valid('<ENTER> to edit in ' + getSettingsState().preferredEditor);

		default:
			return invalid({
				message: `Unknown edit option`,
				completionWordList: editModifiers,
			});
	}
};

const validators: Record<CmdKeyword, Validator> = {
	[CmdKeywords.EXPORT]: () => {
		return valid(CONFIRM_MSG + ', and create export markdown file');
	},

	[CmdKeywords.PEEK]: args => {
		const modifier = args.modifier;
		if (modifier === 'now') return valid(CONFIRM_MSG);

		const hint = {
			message: `historical state from: '1h', '2d', '23h', '1mo', '2y', 'previous', 'next' or full date as YYYY-MM-DD`,
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
			});
		}

		const boardCreationDate = safeDateFromUlid(boardResult.value.id);

		if (isFail(boardCreationDate)) {
			return invalid({
				message: 'Unable to peek: board id is not a valid ULID',
			});
		}

		if (
			!isDateWithinPeekHorizon({
				date,
				horizonDate: boardCreationDate.value,
			})
		) {
			return invalid({
				message: chalk.red(
					`nothing to peek before ${boardCreationDate.value
						.toISOString()
						.slice(0, 16)
						.replace('T', ' ')}`,
				),
			});
		}

		return valid(CONFIRM_MSG);
	},

	[CmdKeywords.EXIT]: () => valid(CONFIRM_MSG + ' and exit the application'),
	[CmdKeywords.INIT]: () => valid(CONFIRM_MSG),
	[CmdKeywords.PALETTE]: () => valid(CONFIRM_MSG),

	[CmdKeywords.FILTER]: args => {
		if (args.modifier === 'clear') return valid();

		const isValidModifier = (val: string): val is Filter['target'] =>
			getCmdModifiers(CmdKeywords.FILTER).includes(val);

		if (!args.modifier || !isValidModifier(args.modifier)) {
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

		if (wordList.length && !wordList.includes(args.inputString.trim())) {
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
		const wordList = getCmdModifiers(CmdKeywords.NONE);

		return invalid({
			message: buildHint({
				prefix: '... ',
				wordList,
				inputString: args.inputString,
				minLengthForHints: 0,
			}),
			completionWordList: wordList,
		});
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

	[CmdKeywords.HELP]: () => valid(CONFIRM_MSG),

	[CmdKeywords.EDIT]: validateEditCommand,

	[CmdKeywords.CONFIG]: validateConfigCommand,

	[CmdKeywords.DELETE]: args => {
		const editableNodeTypeValidation = guardBoardSwimlaneTicketNodes();
		if (editableNodeTypeValidation.validity === 'invalid') {
			return editableNodeTypeValidation;
		}

		return requireExact(args);
	},

	[CmdKeywords.CLOSE_ISSUE]: args => requireExact(args),
	[CmdKeywords.RE_OPEN_ISSUE]: args => requireExact(args),

	[CmdKeywords.MOVE]: args => {
		const editableNodeTypeValidation = guardBoardSwimlaneTicketNodes();
		if (editableNodeTypeValidation.validity === 'invalid') {
			return editableNodeTypeValidation;
		}

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

		const existingTags = tags.join('');

		return requireModifierOrInputStr({
			hint: existingTags.length
				? 'existing tags ... ' + existingTags
				: 'create tag ...',
		})(args);
	},

	[CmdKeywords.UNTAG]: args => {
		const tagsRes = ticketTagsFromBreadCrumb();
		if (isFail(tagsRes)) {
			return invalid({message: 'Invalid untag target', completionWordList: []});
		}

		const tags = tagsRes.value
			.map(({name}) => name)
			.map(tag => ` ${chalk.bgHex(getStringColor(tag))(' ' + tag + ' ')} `)
			.slice(0, 10);

		if (!tags.length) {
			return invalid({message: 'Issue has no tags', completionWordList: []});
		}

		return requireModifierOrInputStr({
			hint: ' ... ' + tags.join(''),
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

	[CmdKeywords.UNASSIGN]: args => {
		const assigneesRes = ticketAssigneesFromBreadCrumb();
		if (isFail(assigneesRes)) {
			return invalid({
				message: 'Invalid unassign target',
				completionWordList: [],
			});
		}

		const coloredAssignees = assigneesRes.value
			.map(({name}) => name)
			.map(
				assignee =>
					` ${chalk.bgHex(getStringColor(assignee))(' ' + assignee + ' ')} `,
			)
			.slice(0, 10);

		if (!coloredAssignees.length) {
			return invalid({
				message: 'Issue has no assignees',
				completionWordList: [],
			});
		}

		return requireModifierOrInputStr({
			hint: 'remove assignee... ' + coloredAssignees.join(''),
		})(args);
	},

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
