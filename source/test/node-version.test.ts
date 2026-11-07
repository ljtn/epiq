import {describe, expect, it} from 'vitest';
import {MIN_NODE_MAJOR, nodeVersionProblem} from '../lib/utils/node-version.js';

describe('nodeVersionProblem', () => {
	it('accepts the minimum and anything newer', () => {
		expect(nodeVersionProblem(`${MIN_NODE_MAJOR}.0.0`)).toBeNull();
		expect(nodeVersionProblem('24.11.1')).toBeNull();
	});

	it('names the required and the found version for an older Node', () => {
		const problem = nodeVersionProblem('20.19.0');
		expect(problem).toContain(`Node ${MIN_NODE_MAJOR} or newer`);
		expect(problem).toContain('20.19.0');
	});

	it('refuses a version it cannot read', () => {
		expect(nodeVersionProblem('')).not.toBeNull();
	});
});
