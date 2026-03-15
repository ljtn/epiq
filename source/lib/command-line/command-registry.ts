import {settings} from '../settings/settings.js';
import {TAGS_DEFAULT} from '../static/default-tags.js';
import {
	CmdKeyword,
	CmdKeywords,
	CmdModifiers,
	CmdResults,
	DefaultCmdModifier,
	Result,
} from './command-types.js';

export const CmdMeta: Record<
	CmdKeyword,
	{
		autoCompleteHints: string[];
		validateCmd: (cw: CmdKeyword, cm: DefaultCmdModifier | string) => Result;
	}
> = {
	[CmdKeywords.DELETE]: {
		autoCompleteHints: ['confirm'],
		validateCmd: (_command, modifier) => ({
			result: CmdModifiers.Node.includes(modifier)
				? CmdResults.Succeed
				: CmdResults.Fail,
		}),
	},
	[CmdKeywords.RENAME]: {
		autoCompleteHints: [],
		validateCmd: (_command, _modifier) => ({result: CmdResults.Succeed}),
	},
	[CmdKeywords.ADD]: {
		autoCompleteHints: [],
		validateCmd: (_command, _modifier) => ({result: CmdResults.Succeed}),
	},
	[CmdKeywords.HELP]: {
		autoCompleteHints: [],
		validateCmd: (_command, _modifier) => ({result: CmdResults.Succeed}),
	},
	[CmdKeywords.VIEW]: {
		autoCompleteHints: ['dense', 'wide'],
		validateCmd: (_command, modifier) => {
			const success = modifier === 'dense' || modifier === 'wide';
			return {result: success ? CmdResults.Succeed : CmdResults.Fail};
		},
	},
	[CmdKeywords.TAG]: {
		autoCompleteHints: Object.keys(TAGS_DEFAULT),
		validateCmd: _command => {
			return {result: CmdResults.Succeed};
		},
	},
	[CmdKeywords.ASSIGN]: {
		autoCompleteHints: settings.users,
		validateCmd: (_command, modifier) => {
			const success = settings.users.includes(modifier);
			return {
				result: success ? CmdResults.Succeed : CmdResults.Fail,
				hint: !success ? 'Must be existing user name' : '',
			};
		},
	},
} as const;
