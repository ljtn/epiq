import {describe, expect, it} from 'vitest';
import {cmdValidation} from '../command-validation.js';
import {CmdKeywords, cmdValidity} from '../command-types.js';
import {getCmdModifiers} from '../auto-completion-commands.js';

describe('cmdValidation', () => {
	const cmdModifiers = getCmdModifiers();
	describe('NEW', () => {
		it('accepts when modifier matches one of the allowed values', () => {
			const modifier = cmdModifiers[CmdKeywords.NEW][0]!;
			const result = cmdValidation[CmdKeywords.NEW].validate(
				CmdKeywords.NEW,
				modifier,
				'',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBeUndefined();
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
			expect(result.message).toBeUndefined();
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
			expect(result.message).toBeUndefined();
		});
	});

	describe('DELETE', () => {
		it('accepts when modifier matches the exact expected value', () => {
			const modifier = cmdModifiers[CmdKeywords.DELETE][0]!;

			const result = cmdValidation[CmdKeywords.DELETE].validate(
				CmdKeywords.DELETE,
				modifier,
				'',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBeUndefined();
		});

		it('rejects when modifier is empty', () => {
			const expected = cmdModifiers[CmdKeywords.DELETE][0]!;

			const result = cmdValidation[CmdKeywords.DELETE].validate(
				CmdKeywords.DELETE,
				'',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toBe(`to proceed, enter "${expected}"`);
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
			const modifier = cmdModifiers[CmdKeywords.VIEW][0]!;

			const result = cmdValidation[CmdKeywords.VIEW].validate(
				CmdKeywords.VIEW,
				modifier,
				'',
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBeUndefined();
		});

		it('rejects when modifier is empty', () => {
			const result = cmdValidation[CmdKeywords.VIEW].validate(
				CmdKeywords.VIEW,
				'',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toBeTruthy();
		});

		it('rejects when modifier is not one of the allowed values', () => {
			const result = cmdValidation[CmdKeywords.VIEW].validate(
				CmdKeywords.VIEW,
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
			expect(result.message).toBeUndefined();
		});

		it('rejects when inputString is empty', () => {
			const result = cmdValidation[CmdKeywords.TAG].validate(
				CmdKeywords.TAG,
				'',
				'',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
			expect(result.message).toMatch(/^provide tag name like /);
		});
	});

	describe('ASSIGN', () => {
		it('accepts when modifier matches one of the allowed values', () => {
			const modifier = cmdModifiers[CmdKeywords.ASSIGN][0]!;
			const result = cmdValidation[CmdKeywords.ASSIGN].validate(
				CmdKeywords.ASSIGN,
				modifier,
				modifier,
			);

			expect(result.validity).toBe(cmdValidity.Valid);
			expect(result.message).toBeUndefined();
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

		it('rejects when modifier is not one of the allowed values', () => {
			const result = cmdValidation[CmdKeywords.ASSIGN].validate(
				CmdKeywords.ASSIGN,
				'unknown-user',
				'unknown-user',
			);

			expect(result.validity).toBe(cmdValidity.Invalid);
		});
	});
});
