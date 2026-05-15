import {beforeAll, describe, expect, it, vi} from 'vitest';
import {cmdValidity} from '../lib/command-line/cmd-validity.js';
import {CmdKeywords} from '../lib/command-line/cmd-keywords.js';
import {
	ConfigModifiers,
	EditModifiers,
	getCmdModifiers,
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
});
