import {cmdCompletions} from './auto-completion-commands.js';
import {
	CmdKeyword,
	CmdKeywords,
	CmdValidity,
	cmdValidity,
	DefaultCmdModifier,
} from './command-types.js';

export const CmdValidation: Record<
	CmdKeyword,
	{
		validate: (
			cw: CmdKeyword,
			cm: DefaultCmdModifier | string,
		) => {validity: CmdValidity; message?: string};
	}
> = {
	[CmdKeywords.DELETE]: {
		validate: (_command, modifier) => {
			const valid = modifier.trim() === 'confirm';
			if (valid) {
				return {
					validity: cmdValidity.Valid,
					message: '',
				};
			} else {
				return {
					validity: cmdValidity.Invalid,
					message: !modifier ? 'type "confirm"' : '',
				};
			}
		},
	},
	[CmdKeywords.RENAME]: {
		validate: (_command, _modifier) => ({validity: cmdValidity.Valid}),
	},
	[CmdKeywords.ADD]: {
		validate: (_command, _modifier) => ({validity: cmdValidity.Valid}),
	},
	[CmdKeywords.HELP]: {
		validate: (_command, _modifier) => ({validity: cmdValidity.Valid}),
	},
	[CmdKeywords.VIEW]: {
		validate: (_command, modifier) => {
			const valid = cmdCompletions[CmdKeywords.VIEW].includes(modifier);
			if (valid) {
				return {
					validity: cmdValidity.Valid,
					message: '',
				};
			} else {
				return {
					validity: cmdValidity.Invalid,
					message: !modifier
						? cmdCompletions[CmdKeywords.VIEW].join(' or ')
						: '',
				};
			}
		},
	},
	[CmdKeywords.TAG]: {
		validate: (_command, modifier) => {
			const valid = cmdCompletions[CmdKeywords.TAG].includes(modifier);
			if (valid) {
				return {
					validity: cmdValidity.Valid,
				};
			} else {
				return {
					validity: cmdValidity.Invalid,
					message: !modifier
						? 'provide tags like: ' +
						  cmdCompletions[CmdKeywords.TAG]
								.toSpliced(2)
								.map(x => `"${x}"`)
								.join(' or ')
						: '',
				};
			}
		},
	},
	[CmdKeywords.ASSIGN]: {
		validate: (_command, modifier) => {
			const valid = cmdCompletions[CmdKeywords.ASSIGN].includes(modifier);
			if (valid) {
				return {
					validity: cmdValidity.Valid,
					message: '',
				};
			} else {
				return {
					validity: cmdValidity.Invalid,
					message: !modifier
						? 'some username like ' +
						  cmdCompletions[CmdKeywords.ASSIGN]
								.toSpliced(2)
								.map(x => `"${x}"`)
								.join(' or ')
						: '',
				};
			}
		},
	},
} as const;
