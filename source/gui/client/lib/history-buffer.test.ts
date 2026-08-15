import {describe, expect, it, vi} from 'vitest';
import {createHistoryBuffer, HistoryWindow} from './history-buffer';
import {GuiCommitEntry, GuiEventTimeline} from './gui-state.model';

const timeline = (label: string): GuiEventTimeline =>
	({
		earliest: 0,
		latest: 1,
		buckets: [{t: 0, count: 1}],
		label,
	} as unknown as GuiEventTimeline);

const commits = (label: string): GuiCommitEntry[] =>
	[{hash: label}] as unknown as GuiCommitEntry[];

const setup = () => {
	const published: HistoryWindow[] = [];
	const buffer = createHistoryBuffer(window => published.push(window));
	return {buffer, published};
};

describe('createHistoryBuffer', () => {
	it('publishes nothing until both halves have arrived', () => {
		const {buffer, published} = setup();
		const id = buffer.open();

		buffer.accept(id, {timeline: timeline('A')});
		expect(published).toEqual([]);

		buffer.accept(id, {commits: commits('A')});
		expect(published).toHaveLength(1);
		expect(published[0]?.timeline).toEqual(timeline('A'));
		expect(published[0]?.commits).toEqual(commits('A'));
	});

	it('publishes regardless of which half arrives first', () => {
		const {buffer, published} = setup();
		const id = buffer.open();

		buffer.accept(id, {commits: commits('A')});
		buffer.accept(id, {timeline: timeline('A')});

		expect(published).toHaveLength(1);
	});

	it('never pairs halves from different requests', () => {
		const {buffer, published} = setup();

		const a = buffer.open();
		buffer.accept(a, {timeline: timeline('A')});

		const b = buffer.open();
		buffer.accept(a, {commits: commits('A')});
		buffer.accept(b, {timeline: timeline('B')});

		expect(published).toEqual([]);

		buffer.accept(b, {commits: commits('B')});
		expect(published).toHaveLength(1);
		expect(published[0]?.timeline).toEqual(timeline('B'));
		expect(published[0]?.commits).toEqual(commits('B'));
	});

	it('drops replies to a request that was abandoned entirely', () => {
		const {buffer, published} = setup();

		const a = buffer.open();
		const b = buffer.open();

		buffer.accept(a, {timeline: timeline('A')});
		buffer.accept(a, {commits: commits('A')});

		expect(published).toEqual([]);

		buffer.accept(b, {timeline: timeline('B')});
		buffer.accept(b, {commits: commits('B')});

		expect(published).toHaveLength(1);
		expect(published[0]?.timeline).toEqual(timeline('B'));
	});

	it('ignores a late duplicate of an already published window', () => {
		const {buffer, published} = setup();
		const id = buffer.open();

		buffer.accept(id, {timeline: timeline('A')});
		buffer.accept(id, {commits: commits('A')});
		expect(published).toHaveLength(1);

		buffer.accept(id, {timeline: timeline('A')});
		buffer.accept(id, {commits: commits('A')});

		expect(published).toHaveLength(1);
	});

	it('ignores a reply that carries no request id', () => {
		const {buffer, published} = setup();
		buffer.open();

		buffer.accept(undefined, {timeline: timeline('A')});
		buffer.accept(undefined, {commits: commits('A')});

		expect(published).toEqual([]);
	});

	it('hands out a fresh id per request', () => {
		const {buffer} = setup();

		expect(buffer.open()).not.toBe(buffer.open());
	});

	it('publishes through the callback it was given', () => {
		const publish = vi.fn();
		const buffer = createHistoryBuffer(publish);
		const id = buffer.open();

		buffer.accept(id, {timeline: timeline('A')});
		buffer.accept(id, {commits: commits('A')});

		expect(publish).toHaveBeenCalledTimes(1);
	});
});
