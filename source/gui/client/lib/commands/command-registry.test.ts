import {describe, expect, it, vi} from 'vitest';
import {CmdKeywords} from '../../../../lib/command-line/cmd-keywords.js';
import {buildCommandRegistry, commandRank} from './command-registry';
import {CommandContext, CommandHandlers} from './command.model';
import {GuiIssue} from '../gui-state.model';

const handlers = (): CommandHandlers => ({
	createIssue: vi.fn(),
	closeIssue: vi.fn(),
	reopenIssue: vi.fn(),
	addIssueTag: vi.fn(),
	removeIssueTag: vi.fn(),
	addIssueAssignee: vi.fn(),
	removeIssueAssignee: vi.fn(),
	commentOnIssue: vi.fn(),
	copyRef: vi.fn(),
	sync: vi.fn(),
	startTheatre: vi.fn(),
	returnToLive: vi.fn(),
	toggleLog: vi.fn(),
	createSwimlane: vi.fn(),
});

const issue = (overrides: Partial<GuiIssue> = {}): GuiIssue => ({
	isClosed: false,
	id: 'issue-1',
	ref: 'ABC1234',
	title: 'A ticket',
	description: '',
	createdAt: 0,
	readonly: false,
	tags: [],
	assignees: [],
	...overrides,
});

const context = (overrides: Partial<CommandContext> = {}): CommandContext => ({
	connected: true,
	scrubbing: false,
	issue: issue(),
	tags: [],
	contributors: [],
	handlers: handlers(),
	...overrides,
});

const find = (id: string) => {
	const command = buildCommandRegistry().find(entry => entry.id === id);
	if (!command) throw new Error(`No command ${id}`);

	return command;
};

describe('the GUI command registry', () => {
	// What keeps "the same commands" honest: the GUI cannot import the TUI's
	// command machinery, so only a test holds the two vocabularies together.
	it('names every shared command after a TUI keyword', () => {
		const keywords = new Set<string>(Object.values(CmdKeywords));

		for (const command of buildCommandRegistry()) {
			if (command.id.startsWith('gui:')) continue;

			expect(keywords, `${command.id} is not a TUI keyword`).toContain(
				command.id,
			);
		}
	});

	it('gives every command a title and a group', () => {
		for (const command of buildCommandRegistry()) {
			expect(command.title.length).toBeGreaterThan(0);
			expect(command.group.length).toBeGreaterThan(0);
		}
	});

	it('has no two commands under one id', () => {
		const ids = buildCommandRegistry().map(command => command.id);

		expect(new Set(ids).size).toBe(ids.length);
	});

	describe('availability', () => {
		it('holds every write back while the board is in the past', () => {
			const scrubbed = context({scrubbing: true});

			expect(find(CmdKeywords.NEW).unavailable(scrubbed)).toBe(
				'Read-only while viewing history',
			);
			expect(find(CmdKeywords.CLOSE_ISSUE).unavailable(scrubbed)).toBe(
				'Read-only while viewing history',
			);
		});

		it('holds every write back while the socket is down', () => {
			expect(
				find(CmdKeywords.NEW).unavailable(context({connected: false})),
			).toBe('Not connected');
		});

		// Copying a ref asks the server for nothing, so a dropped socket is no
		// reason to refuse it.
		it('still copies a ref while offline', () => {
			expect(
				find(CmdKeywords.YANK).unavailable(context({connected: false})),
			).toBeNull();
		});

		it('asks for a ticket where one is needed', () => {
			expect(
				find(CmdKeywords.COMMENT).unavailable(context({issue: null})),
			).toBe('Open a ticket first');
		});

		it('will not close what is already closed, nor reopen what is open', () => {
			const closed = context({issue: issue({isClosed: true})});

			expect(find(CmdKeywords.CLOSE_ISSUE).unavailable(closed)).toBe(
				'Already closed',
			);
			expect(find(CmdKeywords.RE_OPEN_ISSUE).unavailable(closed)).toBeNull();
			expect(find(CmdKeywords.RE_OPEN_ISSUE).unavailable(context())).toBe(
				'This ticket is open',
			);
		});

		it('offers to return to live only from the past', () => {
			expect(find('gui:live').unavailable(context())).toBe(
				'The board is already live',
			);
			expect(
				find('gui:live').unavailable(context({scrubbing: true})),
			).toBeNull();
		});

		it('sorts what cannot run last', () => {
			const rank = commandRank(context({issue: null}));

			expect(rank(find(CmdKeywords.SYNC))).toBe(0);
			expect(rank(find(CmdKeywords.COMMENT))).toBe(1);
		});
	});

	describe('the two-stage commands', () => {
		const tags = [
			{id: 'tag-1', name: 'bug', color: '#f00'},
			{id: 'tag-2', name: 'gui', color: '#0f0'},
		];

		it('offers only the tags the ticket does not already carry', () => {
			const withOne = context({
				tags,
				issue: issue({tags: [tags[0]!]}),
			});

			expect(
				find(CmdKeywords.TAG)
					.getArguments?.(withOne)
					.map(one => one.title),
			).toEqual(['gui']);
		});

		it('offers only the tags it does carry, to remove', () => {
			const withOne = context({tags, issue: issue({tags: [tags[0]!]})});

			expect(
				find(CmdKeywords.UNTAG)
					.getArguments?.(withOne)
					.map(one => one.title),
			).toEqual(['bug']);
		});

		it('says so rather than opening an empty list', () => {
			expect(find(CmdKeywords.UNTAG).unavailable(context({tags}))).toBe(
				'This ticket has no tags',
			);
			expect(find(CmdKeywords.UNASSIGN).unavailable(context())).toBe(
				'Nobody is assigned',
			);
		});

		it('leaves out a removed contributor, and marks you', () => {
			const withPeople = context({
				contributors: [
					{
						id: 'u1',
						name: 'jola',
						color: '#00f',
						isSelf: true,
						isRemoved: false,
						hasAuthoredAnywhere: true,
					},
					{
						id: 'u2',
						name: 'gone',
						color: '#00f',
						isSelf: false,
						isRemoved: true,
						hasAuthoredAnywhere: true,
					},
				],
			});

			const offered = find(CmdKeywords.ASSIGN).getArguments?.(withPeople);

			expect(offered?.map(one => one.title)).toEqual(['jola']);
			expect(offered?.[0]?.hint).toBe('you');
		});

		// The tag is applied by name, since that is what the mutation takes — a
		// tag that does not exist yet is created by the same call.
		it('applies a tag by name and removes one by id', () => {
			const applying = context({tags});
			find(CmdKeywords.TAG).run(applying, {id: 'tag-2', title: 'gui'});

			expect(applying.handlers.addIssueTag).toHaveBeenCalledWith(
				'issue-1',
				'gui',
			);

			const removing = context({tags, issue: issue({tags: [tags[0]!]})});
			find(CmdKeywords.UNTAG).run(removing, {id: 'tag-1', title: 'bug'});

			expect(removing.handlers.removeIssueTag).toHaveBeenCalledWith(
				'issue-1',
				'tag-1',
			);
		});

		// A board with no tags yet would otherwise offer an empty list and no way
		// forward. The mutation creates the tag, so naming one is enough.
		it('offers a tag name the board has never held', () => {
			const tag = find(CmdKeywords.TAG);

			expect(tag.freeTextArgument?.('urgent')?.title).toBe('urgent');
			expect(tag.freeTextArgument?.('  spaced  ')?.title).toBe('spaced');
			expect(tag.freeTextArgument?.('   ')).toBeNull();
		});

		// Only where the argument can be named into being: unassigning names
		// somebody already on the ticket.
		it('does not invent an argument for the commands that cannot take one', () => {
			expect(find(CmdKeywords.UNTAG).freeTextArgument).toBeUndefined();
			expect(find(CmdKeywords.ASSIGN).freeTextArgument).toBeUndefined();
		});

		// A stale second step: the ticket closed under it, or the palette was
		// driven by a test. Nothing should fire without an argument.
		it('does nothing when the argument is missing', () => {
			const bare = context({tags});
			find(CmdKeywords.TAG).run(bare);

			expect(bare.handlers.addIssueTag).not.toHaveBeenCalled();
		});
	});

	it('runs the plain commands against the ticket in hand', () => {
		const running = context();

		find(CmdKeywords.CLOSE_ISSUE).run(running);
		find(CmdKeywords.YANK).run(running);
		find(CmdKeywords.SYNC).run(running);

		expect(running.handlers.closeIssue).toHaveBeenCalledWith('issue-1');
		expect(running.handlers.copyRef).toHaveBeenCalledWith('ABC1234');
		expect(running.handlers.sync).toHaveBeenCalled();
	});
});
