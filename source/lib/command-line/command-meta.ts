import {CurrentCmdMeta} from '../state/cmd.state.js';
import {CmdMeta} from './command-registry.js';
import {
	CmdKeyword,
	CmdKeywords,
	CmdResults,
	DefaultCmdModifier,
} from './command-types.js';

export const CmdIntent = {
	// Fundamentals (tight coupling to scope)
	None: 'none',
	AddBoard: 'add-board',
	AddSwimlane: 'add-swimlane',
	AddTicket: 'add-ticket',
	AddListItem: 'add-list-item',
	ViewHelp: 'view-help',
	Rename: 'rename',
	Delete: 'delete',
	SetView: 'set-view',

	// Higher order
	TagTicket: 'ticket-tag',
	AssignUserToTicket: 'ticket-assign-user',
} as const;

export const isCmdKeyword = (word: string): word is CmdKeyword =>
	Object.values(CmdKeywords).includes(word as CmdKeyword);

export const getCmdMeta = (value: string): CurrentCmdMeta => {
	const words = value.split(' ');
	const [firstWord, ...rest] = words;
	const [secondWord] = rest;
	const firstWordIsCmdKeyword = isCmdKeyword(words[0] as CmdKeyword);

	const modifier = (rest.join?.(' ') ?? '').trim();
	if (firstWord && firstWordIsCmdKeyword) {
		const meta = CmdMeta[firstWord as CmdKeyword];
		const validation = meta.validateCmd(
			(firstWord as CmdKeyword) ?? '',
			(secondWord as DefaultCmdModifier) ?? '',
		);
		return {
			command: firstWord,
			modifier,
			hints: meta.hints,
			infoMessage: validation.message ?? '',
			validationStatus: validation.result,
		};
	}
	return {
		validationStatus: CmdResults.None,
		infoMessage: '',
		hints: [''],
		command: firstWord ?? '',
		modifier,
	};
};
