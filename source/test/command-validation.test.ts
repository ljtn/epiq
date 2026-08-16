import {beforeAll, describe, expect, it, vi} from 'vitest';
import {cmdValidity} from '../lib/command-line/cmd-validity.js';
import {CmdKeywords} from '../lib/command-line/cmd-keywords.js';
import {MAX_COMMENT_LENGTH} from '../lib/utils/comment.limits.js';
import {
	ConfigModifiers,
	EditModifiers,
	getCmdModifiers,
	getEditModifiers,
} from '../lib/command-line/command-modifiers.js';

vi.mock('../lib/state/state.js', () => ({
	getState: () => ({
		contextNode: {
			id: 'swimlane-1',
			title: 'Swimlane 1',
			context: 'SWIMLANE',
			parentNodeId: 'board-1',
		},
		selectedNode: {
			id: 'ticket-1',
			title: 'Ticket 1',
			context: 'TICKET',
			parentNodeId: 'swimlane-1',
		},
		contributors: {
			'user-1': {id: 'user-1', name: 'john'},
			'user-2': {id: 'user-2', name: 'jane'},
		},
		tags: {},
		breadCrumb: [],
	}),
}));

vi.mock('../lib/state/settings.state.js', () => ({
	getSettingsState: () => ({
		preferredEditor: 'vim',
		autoSync: true,
		autoSyncIntervalMs: 15000,
	}),
}));

vi.mock('../lib/repository/node-repo.js', () => ({
	nodeRepo: {
		getExistingTags: () => ['critical', 'frontend', 'backend'],
		getExistingAssignees: () => ['john', 'jane'],
	},
}));

vi.mock('../lib/utils/ticket.utils.js', () => ({
	ticketTagsFromBreadCrumb: () => ({
		status: 'success',
		message: 'ok',
		value: [],
	}),
	ticketAssigneesFromBreadCrumb: () => ({
		status: 'success',
		message: 'ok',
		value: [],
	}),
}));

vi.mock('../lib/command-line/command-modifiers.js', async importOriginal => {
	const actual = await importOriginal<
		typeof import('../lib/command-line/command-modifiers.js')
	>();

	return {
		...actual,
		getCmdModifiers: (keyword: string) => {
			const m: Record<string, string[]> = {
				[CmdKeywords.DELETE]: ['confirm'],
				[CmdKeywords.CONFIG]: [
					actual.ConfigModifiers.EDITOR,
					actual.ConfigModifiers.VIEW,
					actual.ConfigModifiers.USERNAME,
					actual.ConfigModifiers.AUTOSYNC,
					actual.ConfigModifiers.SYNC_DEBOUNCE_MS,
				],
				[CmdKeywords.EDIT]: [
					actual.EditModifiers.TITLE,
					actual.EditModifiers.DESCRIPTION,
				],
				[CmdKeywords.TAG]: ['critical', 'frontend', 'backend'],
				[CmdKeywords.ASSIGN]: ['john', 'jane'],
				[CmdKeywords.HELP]: [],
				[CmdKeywords.NEW]: ['issue', 'swimlane', 'board'],
			};

			return m[keyword] ?? [];
		},
	};
});

let cmdValidation: typeof import('../lib/command-line/command-validation.js').cmdValidation;

beforeAll(async () => {
	({cmdValidation} = await import('../lib/command-line/command-validation.js'));
});

describe('cmdValidation', () => {
	describe('NEW', () => {
		it('accepts when modifier matches one of the allowed values', () => {
			const modifier = getCmdModifiers(CmdKeywords.NEW)[0]!;
			const result = cmdValidation[CmdKeywords.NEW].validate(
				CmdKeywords.NEW,
				modifier,
				' a',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('');
		});

		it('rejects when modifier is empty', () => {
			const result = cmdValidation[CmdKeywords.NEW].validate(
				CmdKeywords.NEW,
				'',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toBeTruthy();
		});

		it('rejects when modifier is not one of the allowed values', () => {
			const result = cmdValidation[CmdKeywords.NEW].validate(
				CmdKeywords.NEW,
				'not-a-valid-option',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
		});
	});

	describe('HELP', () => {
		it('accepts any input', () => {
			const result = cmdValidation[CmdKeywords.HELP].validate(
				CmdKeywords.HELP,
				'any-value',
				'any input string',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to confirm');
		});
	});

	describe('EDIT', () => {
		it('accepts title edit', () => {
			const result = cmdValidation[CmdKeywords.EDIT].validate(
				CmdKeywords.EDIT,
				EditModifiers.TITLE,
				'',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to confirm');
		});

		it('accepts description edit', () => {
			const result = cmdValidation[CmdKeywords.EDIT].validate(
				CmdKeywords.EDIT,
				EditModifiers.DESCRIPTION,
				'',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to edit in vim');
		});

		it('rejects unknown edit modifier', () => {
			const result = cmdValidation[CmdKeywords.EDIT].validate(
				CmdKeywords.EDIT,
				'unknown',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toBe('Unknown edit option');
		});
	});

	describe('getEditModifiers', () => {
		it('offers only title for swimlanes', () => {
			expect(getEditModifiers('SWIMLANE')).toEqual([EditModifiers.TITLE]);
		});

		it('offers only title for boards', () => {
			expect(getEditModifiers('BOARD')).toEqual([EditModifiers.TITLE]);
		});

		it('offers title and description for tickets', () => {
			expect(getEditModifiers('TICKET')).toEqual([
				EditModifiers.TITLE,
				EditModifiers.DESCRIPTION,
			]);
		});

		it('offers only comment for comments', () => {
			expect(getEditModifiers('COMMENT')).toEqual([EditModifiers.COMMENT]);
		});

		it('offers nothing for non-editable contexts', () => {
			expect(getEditModifiers('FIELD')).toEqual([]);
		});

		it('falls back to the selected node context when omitted', () => {
			// getState() mock selects a TICKET
			expect(getEditModifiers()).toEqual([
				EditModifiers.TITLE,
				EditModifiers.DESCRIPTION,
			]);
		});
	});

	describe('DELETE', () => {
		it('accepts when modifier matches the exact expected value', () => {
			const modifier = getCmdModifiers(CmdKeywords.DELETE)[0]!;

			const result = cmdValidation[CmdKeywords.DELETE].validate(
				CmdKeywords.DELETE,
				modifier,
				'',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to confirm');
		});

		it('rejects when modifier is empty', () => {
			const result = cmdValidation[CmdKeywords.DELETE].validate(
				CmdKeywords.DELETE,
				'',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toMatch(/^if you are certain, enter/);
		});

		it('rejects when modifier is wrong', () => {
			const result = cmdValidation[CmdKeywords.DELETE].validate(
				CmdKeywords.DELETE,
				'wrong',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
		});
	});

	describe('CONFIG view', () => {
		it('accepts when inputString matches one of the allowed values', () => {
			const result = cmdValidation[CmdKeywords.CONFIG].validate(
				CmdKeywords.CONFIG,
				ConfigModifiers.VIEW,
				'dense',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to confirm');
		});

		it('rejects when inputString is empty', () => {
			const result = cmdValidation[CmdKeywords.CONFIG].validate(
				CmdKeywords.CONFIG,
				ConfigModifiers.VIEW,
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toBeTruthy();
		});

		it('rejects when inputString is not one of the allowed values', () => {
			const result = cmdValidation[CmdKeywords.CONFIG].validate(
				CmdKeywords.CONFIG,
				ConfigModifiers.VIEW,
				'not-a-valid-option',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
		});
	});

	describe('CONFIG autoSync', () => {
		it('accepts yes', () => {
			const result = cmdValidation[CmdKeywords.CONFIG].validate(
				CmdKeywords.CONFIG,
				ConfigModifiers.AUTOSYNC,
				'on',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
		});

		it('accepts no', () => {
			const result = cmdValidation[CmdKeywords.CONFIG].validate(
				CmdKeywords.CONFIG,
				ConfigModifiers.AUTOSYNC,
				'off',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
		});

		it('rejects invalid value', () => {
			const result = cmdValidation[CmdKeywords.CONFIG].validate(
				CmdKeywords.CONFIG,
				ConfigModifiers.AUTOSYNC,
				'maybe',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
		});
	});

	describe('CONFIG syncDebounceMs', () => {
		it('accepts duration above minimum', () => {
			const result = cmdValidation[CmdKeywords.CONFIG].validate(
				CmdKeywords.CONFIG,
				ConfigModifiers.SYNC_DEBOUNCE_MS,
				'15000',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to confirm');
		});

		it('rejects duration below minimum', () => {
			const result = cmdValidation[CmdKeywords.CONFIG].validate(
				CmdKeywords.CONFIG,
				ConfigModifiers.SYNC_DEBOUNCE_MS,
				'1000',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toContain('provide duration above');
		});

		it('rejects non-number duration', () => {
			const result = cmdValidation[CmdKeywords.CONFIG].validate(
				CmdKeywords.CONFIG,
				ConfigModifiers.SYNC_DEBOUNCE_MS,
				'abc',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
		});
	});

	describe('TAG', () => {
		it('accepts a non-empty inputString even when it is not in the completion list', () => {
			const result = cmdValidation[CmdKeywords.TAG].validate(
				CmdKeywords.TAG,
				'',
				'backend-platform',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to confirm');
		});

		it('rejects when inputString is empty', () => {
			const result = cmdValidation[CmdKeywords.TAG].validate(
				CmdKeywords.TAG,
				'',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toBeTruthy();
		});
	});

	describe('ASSIGN', () => {
		it('accepts when inputString is provided', () => {
			const result = cmdValidation[CmdKeywords.ASSIGN].validate(
				CmdKeywords.ASSIGN,
				'',
				'john',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to confirm');
		});

		it('rejects when inputString is empty', () => {
			const result = cmdValidation[CmdKeywords.ASSIGN].validate(
				CmdKeywords.ASSIGN,
				'',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toBeTruthy();
		});

		it('accepts unknown assignee input', () => {
			const result = cmdValidation[CmdKeywords.ASSIGN].validate(
				CmdKeywords.ASSIGN,
				'',
				'unknown-user',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to confirm');
		});
	});

	describe('PEEK', () => {
		it('rejects an empty target with the input-format hint', () => {
			const result = cmdValidation[CmdKeywords.PEEK].validate(
				CmdKeywords.PEEK,
				'',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toContain('historical state from');
		});

		it('recognizes a full date supplied via inputString', () => {
			// Absolute dates (YYYY-MM-DD) are not in the modifier allow-list, so the
			// parser surfaces them as `inputString`. They must still be accepted as a
			// valid peek target rather than rejected as unrecognized input. (With no
			// board in the breadcrumb the validator then stops at the context check,
			// which proves the date itself was parsed and accepted.)
			const result = cmdValidation[CmdKeywords.PEEK].validate(
				CmdKeywords.PEEK,
				'',
				'2027-06-19',
			);

			expect(result.message).not.toContain('historical state from');
			expect(result.message).toContain('not applicable in this context');
		});
	});

	describe('COMMENT', () => {
		it('prompts for a body when nothing has been typed', () => {
			const result = cmdValidation[CmdKeywords.COMMENT].validate(
				CmdKeywords.COMMENT,
				'',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toContain(String(MAX_COMMENT_LENGTH));
		});

		it('accepts a comment of a thousand characters', () => {
			const result = cmdValidation[CmdKeywords.COMMENT].validate(
				CmdKeywords.COMMENT,
				'',
				'x'.repeat(1000),
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).not.toContain('max input exceeded');
		});

		it('still warns past the shared limit', () => {
			const result = cmdValidation[CmdKeywords.COMMENT].validate(
				CmdKeywords.COMMENT,
				'',
				'x'.repeat(MAX_COMMENT_LENGTH + 1),
			);

			expect(result.message).toContain('max input exceeded');
		});

		it('counts up to the same limit the other clients enforce', () => {
			const result = cmdValidation[CmdKeywords.COMMENT].validate(
				CmdKeywords.COMMENT,
				'',
				'hello',
			);

			expect(result.message).toContain(`5/${MAX_COMMENT_LENGTH}`);
		});
	});
});
