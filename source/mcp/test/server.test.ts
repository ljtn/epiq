import {describe, expect, it, vi} from 'vitest';
import {failed, succeeded} from '../../lib/command-line/command-types.js';
import {resultJson} from '../server.js';

describe('mcp server helpers', () => {
	it('marks successful Result as non-error MCP response', () => {
		const result = resultJson(
			succeeded('Listed issues', [{id: 'issue-1', title: 'Fix bug'}]),
		);

		expect(result.isError).toBe(false);
		expect(result.content).toHaveLength(1);
		expect(result.content[0]?.type).toBe('text');

		const parsed = JSON.parse(result.content[0]?.text ?? '{}');

		expect(parsed.result).toBe('success');
		expect(parsed.message).toBe('Listed issues');
		expect(parsed.data).toEqual([{id: 'issue-1', title: 'Fix bug'}]);
	});

	it('marks failed Result as MCP error response', () => {
		const result = resultJson(failed('Unable to locate issue'));

		expect(result.isError).toBe(true);
		expect(result.content).toHaveLength(1);

		const parsed = JSON.parse(result.content[0]?.text ?? '{}');

		expect(parsed.result).toBe('fail');
		expect(parsed.message).toBe('Unable to locate issue');
	});
});
