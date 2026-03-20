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
		hints: string[];
		validateCmd: (cw: CmdKeyword, cm: DefaultCmdModifier | string) => Result;
	}
> = {
	[CmdKeywords.DELETE]: {
		hints: [CmdModifiers.Node],
		validateCmd: (_command, modifier) => {
			if (CmdModifiers.Node === modifier.trim()) {
				return {
					result: CmdResults.Succeed,
					message: 'heh',
				};
			} else {
				return {
					result: CmdResults.Fail,
					message: 'Provide name of the node to be removed',
				};
			}
		},
	},
	[CmdKeywords.RENAME]: {
		hints: [],
		validateCmd: (_command, _modifier) => ({result: CmdResults.Succeed}),
	},
	[CmdKeywords.ADD]: {
		hints: [],
		validateCmd: (_command, _modifier) => ({result: CmdResults.Succeed}),
	},
	[CmdKeywords.HELP]: {
		hints: [],
		validateCmd: (_command, _modifier) => ({result: CmdResults.Succeed}),
	},
	[CmdKeywords.VIEW]: {
		hints: ['dense', 'wide'],
		validateCmd: (_command, modifier) => {
			const success = modifier === 'dense' || modifier === 'wide';
			return {
				result: success ? CmdResults.Succeed : CmdResults.Fail,
				message: success ? '' : 'view must be "wide" or "dense"',
			};
		},
	},
	[CmdKeywords.TAG]: {
		hints: Object.keys(TAGS_DEFAULT),
		validateCmd: _command => {
			return {result: CmdResults.Succeed};
		},
	},
	[CmdKeywords.ASSIGN]: {
		hints: settings.users,
		validateCmd: (_command, modifier) => {
			const success = settings.users.includes(modifier);
			return {
				result: success ? CmdResults.Succeed : CmdResults.Fail,
				message: !success ? 'Must be existing user name' : '',
			};
		},
	},
} as const;
