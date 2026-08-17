import {describe, expect, it, vi} from 'vitest';

// The batch has to be transparent: same state at the end, and one derive rather
// than one per write, which is what made a replay quadratic.
describe('withDeferredDerive', () => {
	it('is exported alongside updateState', async () => {
		const state = await import('../lib/state/state.js');

		expect(typeof state.withDeferredDerive).toBe('function');
		expect(typeof state.updateState).toBe('function');
	});

	it('runs its callback and returns the value', async () => {
		const {withDeferredDerive} = await import('../lib/state/state.js');
		const fn = vi.fn(() => 'done');

		const result = withDeferredDerive(fn);

		expect(fn).toHaveBeenCalledOnce();
		expect(result.status).toBe('success');
		if (result.status === 'success') expect(result.value).toBe('done');
	});

	it('succeeds when the callback writes nothing', async () => {
		const {withDeferredDerive} = await import('../lib/state/state.js');

		// The path a boot takes before its first event has built the workspace.
		expect(withDeferredDerive(() => 1).status).toBe('success');
	});

	it('rethrows, and does not leave the batch flag stuck on', async () => {
		const {withDeferredDerive} = await import('../lib/state/state.js');

		expect(() =>
			withDeferredDerive(() => {
				throw new Error('boom');
			}),
		).toThrow('boom');

		// Still usable afterwards: a stuck flag would silently defer every later
		// write and never derive again.
		const after = vi.fn(() => 'ok');
		expect(withDeferredDerive(after).status).toBe('success');
		expect(after).toHaveBeenCalledOnce();
	});

	it('joins an outer batch rather than deriving in the middle of one', async () => {
		const {withDeferredDerive} = await import('../lib/state/state.js');
		const inner = vi.fn(() => 'inner');

		const result = withDeferredDerive(() => withDeferredDerive(inner));

		expect(inner).toHaveBeenCalledOnce();
		expect(result.status).toBe('success');
	});
});
