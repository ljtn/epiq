import {beforeAll, describe, expect, it, vi} from 'vitest';
import {CmdKeywords, cmdValidity} from '../lib/command-line/command-types.js';
import {getCmdModifiers} from '../lib/command-line/command-modifiers.js';

vi.mock('../lib/state/state.js', () => ({
	getState: () => ({
		currentNode: {
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

let cmdValidation: typeof import('../lib/command-line/command-validation.js').cmdValidation;

beforeAll(async () => {
	({cmdValidation} = await import('../lib/command-line/command-validation.js'));
});

vi.mock('../lib/command-line/command-modifiers.js', () => ({
	getCmdModifiers: (keyword: string) => {
		const m: Record<string, string[]> = {
			[CmdKeywords.DELETE]: ['confirm'],
			[CmdKeywords.SET_VIEW]: ['dense', 'wide'],
			[CmdKeywords.TAG]: ['critical', 'frontend', 'backend'],
			[CmdKeywords.ASSIGN]: ['john', 'jane'],
			[CmdKeywords.HELP]: [],
			[CmdKeywords.RENAME]: [],
			[CmdKeywords.NEW]: ['issue', 'swimlane', 'board'],
		};
		return m[keyword] ?? [];
	},
}));

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

	describe('RENAME', () => {
		it('accepts any input', () => {
			const result = cmdValidation[CmdKeywords.RENAME].validate(
				CmdKeywords.RENAME,
				'any-value',
				'New name',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to confirm');
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

	describe('VIEW', () => {
		it('accepts when modifier matches one of the allowed values', () => {
			const modifier = getCmdModifiers(CmdKeywords.SET_VIEW)[0]!;

			const result = cmdValidation[CmdKeywords.SET_VIEW].validate(
				CmdKeywords.SET_VIEW,
				modifier,
				'',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to confirm');
		});

		it('rejects when modifier is empty', () => {
			const result = cmdValidation[CmdKeywords.SET_VIEW].validate(
				CmdKeywords.SET_VIEW,
				'',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toBeTruthy();
		});

		it('rejects when modifier is not one of the allowed values', () => {
			const result = cmdValidation[CmdKeywords.SET_VIEW].validate(
				CmdKeywords.SET_VIEW,
				'not-a-valid-option',
				'',
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
			expect(result.message).toMatch(/^tag name like.../);
		});
	});

	describe('ASSIGN', () => {
		it('accepts when modifier matches one of the allowed values', () => {
			const modifier = 'john';
			const result = cmdValidation[CmdKeywords.ASSIGN].validate(
				CmdKeywords.ASSIGN,
				modifier,
				modifier,
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to confirm');
		});

		it('rejects when modifier is empty', () => {
			const result = cmdValidation[CmdKeywords.ASSIGN].validate(
				CmdKeywords.ASSIGN,
				'',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toBeTruthy();
		});

		it('accept when adding new unknown modifier', () => {
			const result = cmdValidation[CmdKeywords.ASSIGN].validate(
				CmdKeywords.ASSIGN,
				'unknown-user',
				'unknown-user',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBe('<ENTER> to confirm');
		});
	});
});
