import {CurrentCmdMeta} from '../state/cmd.state.js';
import {ParsedCommandLine} from './command-parser.js';
import {CmdKeyword, CmdKeywords, cmdValidity} from './command-types.js';
import {cmdValidation} from './command-validation.js';

export const CmdIntent = {
	// Fundamentals (tight coupling to scope)
	None: 'none',
	ViewHelp: 'view-help',
	Rename: 'rename',
	Delete: 'delete',
	SetView: 'set-view',

	// Add
	NewItem: 'add-new-item',

	// Higher order
	TagTicket: 'ticket-tag',
	AssignUserToTicket: 'ticket-assign-user',
} as const;

export const isModifierKeyword = (word: string): word is CmdKeyword =>
	Object.values(CmdKeywords).includes(word as CmdKeyword);

export const isCmdKeyword = (word: string): word is CmdKeyword =>
	Object.values(CmdKeywords).includes(word as CmdKeyword);

export const getCmdMeta = ({
	command,
	modifier,
	inputString,
}: ParsedCommandLine): CurrentCmdMeta => {
	if (command) {
		const {message, validity} = cmdValidation[command].validate(
			command,
			modifier,
			inputString,
		);
		return {
			command,
			modifier,
			infoMessage: message ?? '',
			inputString,
			validity,
		};
	}
	return {
		validity: cmdValidity.None,
		infoMessage: '',
		command,
		inputString: '',
		modifier: '',
	};
};
