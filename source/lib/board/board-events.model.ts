import {
	Actor,
	actorOf,
	Event,
	MaterializeResult as MaterializeResultOf,
	StoredEvent,
} from '../event/event.model.js';
import {
	AttachmentExt,
	Contributor,
	Goal,
	Tag,
} from '../model/app-state.model.js';
import {EmailLink} from '../model/email-link.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {RepoEntry} from './board-repos.js';

/** All string references in event payloads are IDs unless otherwise noted. */

export type MovePosition =
	| {at: 'start'}
	| {at: 'end'}
	| {at: 'before'; sibling: string}
	| {at: 'after'; sibling: string};

export type Position = {
	parent: string;
	rank: string;
};

export type PayloadBase = {id: string};

export type AppEventMap = {
	'init.workspace': {
		payload: PayloadBase & {name: string; rank: string};
		result: NavNode<'WORKSPACE'>;
	};

	'add.workspace': {
		payload: PayloadBase & {name: string; rank: string};
		result: NavNode<'WORKSPACE'>;
	};

	'add.board': {
		payload: PayloadBase & {name: string} & Position;
		result: NavNode<'BOARD'>;
	};

	'add.swimlane': {
		payload: PayloadBase & {name: string} & Position;
		result: NavNode<'SWIMLANE'>;
	};

	'add.issue': {
		payload: PayloadBase & {name: string} & Position;
		result: NavNode<'TICKET'>;
	};

	/** Custom field definition/value node. */
	'add.field': {
		payload: PayloadBase &
			Position & {
				name: string;
				val?: string;
			};
		result: NavNode<'FIELD'>;
	};

	'edit.title': {
		payload: PayloadBase & {name: string};
		result: NavNode<AnyContext>;
	};

	'delete.node': {
		payload: PayloadBase;
		result: NavNode<AnyContext>;
	};

	'create.tag': {
		payload: PayloadBase & {name: string};
		result: Tag;
	};

	/** Hides a tag everywhere, keeping the id and every ticket reference. */
	'tombstone.tag': {
		payload: PayloadBase;
		result: Tag;
	};

	/** Undoes a `tombstone.tag`, carrying the name so replay needn't look back for it. */
	'restore.tag': {
		payload: PayloadBase & {name: string};
		result: Tag;
	};

	/** A goal tickets on any board can belong to. */
	'create.goal': {
		payload: PayloadBase & {name: string};
		result: Goal;
	};

	'rename.goal': {
		payload: PayloadBase & {name: string};
		result: Goal;
	};

	/** What a goal is for, as markdown; empty clears it. */
	'edit.goal.description': {
		payload: PayloadBase & {md: string};
		result: {md: string};
	};

	/** Hides a goal, keeping its id and every ticket's link to it. */
	'tombstone.goal': {
		payload: PayloadBase;
		result: Goal;
	};

	'create.contributor': {
		payload: PayloadBase & {name: string};
		result: Contributor;
	};

	/** Changes a contributor's display name; the registry is the only name source. */
	'rename.contributor': {
		payload: PayloadBase & {name: string};
		result: Contributor;
	};

	/** Clears a contributor's display name, keeping the id and its references. */
	'tombstone.contributor': {
		payload: PayloadBase;
		result: Contributor;
	};

	/**
	 * Undoes a `tombstone.contributor`. Carries the name, so replay never depends
	 * on which earlier events are present.
	 */
	'restore.contributor': {
		payload: PayloadBase & {name: string};
		result: Contributor;
	};

	'add.issue.assignee': {
		payload: PayloadBase & {
			assignee: string;
		};
		result: {
			assignee: string;
		};
	};

	'remove.issue.assignee': {
		payload: PayloadBase & {
			assignee: string;
		};
		result: {
			assignee: string;
		};
	};

	'add.issue.tag': {
		payload: PayloadBase & {
			tag: string;
		};
		result: {
			tag: string;
		};
	};

	'remove.issue.tag': {
		payload: PayloadBase & {
			tag: string;
		};
		result: {
			tag: string;
		};
	};

	'add.issue.goal': {
		payload: PayloadBase & {goal: string};
		result: {goal: string};
	};

	'remove.issue.goal': {
		payload: PayloadBase & {goal: string};
		result: {goal: string};
	};

	'move.node': {
		payload: PayloadBase & Position;
		result: NavNode<AnyContext>;
	};

	'edit.description': {
		payload: PayloadBase & {
			md: string;
		};
		result: {md: string};
	};

	/** Gives a lane a rule, by name; one this build does not know is kept. */
	'add.swimlane.rule': {
		payload: PayloadBase & {rule: string};
		result: {rule: string};
	};

	'remove.swimlane.rule': {
		payload: PayloadBase & {rule: string};
		result: {rule: string};
	};

	'add.issue.comment': {
		payload: PayloadBase & {
			issue: string;
			author: string;
			md: string;
		};
		result: {
			id: string;
			issue: string;
			author: string;
			md: string;
		};
	};

	'edit.issue.comment': {
		payload: PayloadBase & {
			issue: string;
			md: string;
		};
		result: {
			id: string;
			issue: string;
			md: string;
		};
	};

	'delete.issue.comment': {
		payload: PayloadBase & {
			issue: string;
		};
		result: {
			id: string;
			issue: string;
		};
	};

	/**
	 * References a blob at `.epiq/media/<hash>.<ext>`, committed with the event.
	 * Blobs are never deleted, so time travel can render them.
	 */
	'add.issue.attachment': {
		payload: PayloadBase & {
			issue: string;
			author: string;
			hash: string;
			ext: AttachmentExt;
			name: string;
			bytes: number;
		};
		result: {
			id: string;
			issue: string;
			hash: string;
		};
	};

	/** Removes the attachment reference; the blob stays for time travel. */
	'delete.issue.attachment': {
		payload: PayloadBase & {
			issue: string;
		};
		result: {
			id: string;
			issue: string;
		};
	};

	'close.issue': {
		payload: PayloadBase & Position;
		result: {id: string};
	};

	'reopen.issue': {
		payload: PayloadBase & Position;
		result: {id: string};
	};

	'lock.node': {
		payload: PayloadBase;
		result: {id: string};
	};

	'rebalance.children': {
		payload: {
			parent: string;
			ranks: Record<string, string>;
		};
		result: {parent: string};
	};

	/**
	 * Binds a git author address to a contributor, who may be someone else.
	 * An address two contributors claim resolves to nobody.
	 */
	'link.contributor.email': {
		payload: {contributor: string; email: string};
		result: EmailLink;
	};

	/** Retracts a link; allowed only to its author and the contributor it names. */
	'unlink.contributor.email': {
		payload: {contributor: string; email: string};
		result: EmailLink;
	};

	/**
	 * Another repo whose commits count as this board's; its id derives from the URL.
	 * On a live repo, merges the fields it carries.
	 */
	'connect.repo': {
		payload: {
			url: string;
			branches?: 'default' | 'all';
			since?: string;
			/** Empty clears it. */
			label?: string;
		};
		result: RepoEntry;
	};

	/** Changes a live repo's fields; one that is not live is skipped. */
	'edit.repo': {
		payload: {
			repo: string;
			branches?: 'default' | 'all';
			since?: string;
			label?: string;
		};
		result: RepoEntry;
	};

	/** Stops reading a repo. Forward-only: a later connect revives it. */
	'disconnect.repo': {
		payload: {repo: string};
		result: RepoEntry;
	};

	'link.contributor.user': {
		payload: {
			contributor: string;
		};
		result: {
			contributor: string;
			userId: string;
		};
	};
};

export type EventAction = keyof AppEventMap;

/** Every action this build understands; others (from a newer epiq) are skipped on load. */
export const EVENT_ACTIONS = [
	'init.workspace',
	'add.workspace',
	'add.board',
	'add.swimlane',
	'add.issue',
	'add.field',
	'edit.title',
	'delete.node',
	'create.tag',
	'tombstone.tag',
	'restore.tag',
	'create.goal',
	'rename.goal',
	'edit.goal.description',
	'tombstone.goal',
	'create.contributor',
	'rename.contributor',
	'tombstone.contributor',
	'restore.contributor',
	'add.issue.assignee',
	'remove.issue.assignee',
	'add.issue.tag',
	'remove.issue.tag',
	'add.issue.goal',
	'remove.issue.goal',
	'move.node',
	'edit.description',
	'add.swimlane.rule',
	'remove.swimlane.rule',
	'add.issue.comment',
	'edit.issue.comment',
	'delete.issue.comment',
	'add.issue.attachment',
	'delete.issue.attachment',
	'close.issue',
	'reopen.issue',
	'lock.node',
	'rebalance.children',
	'link.contributor.user',
	'link.contributor.email',
	'unlink.contributor.email',
	'connect.repo',
	'edit.repo',
	'disconnect.repo',
] as const satisfies readonly EventAction[];

// Compile-time proof that EVENT_ACTIONS covers every EventAction.
type MissingActions = Exclude<EventAction, (typeof EVENT_ACTIONS)[number]>;
const _assertAllActionsListed: MissingActions extends never ? true : never =
	true;
void _assertAllActionsListed;

const knownEventActions: ReadonlySet<string> = new Set(EVENT_ACTIONS);

export const isKnownEventAction = (action: string): action is EventAction =>
	knownEventActions.has(action);

export type StoredAppEvent<A extends EventAction = EventAction> = StoredEvent<
	AppEventMap,
	A
>;

export type AppEvent<A extends EventAction = EventAction> = Event<
	AppEventMap,
	A
>;

export type MaterializeResult<A extends EventAction> = MaterializeResultOf<
	AppEventMap,
	A
>;

// Re-exported so board code reaches the core through this module alone.
export type EventActor = Actor;
export {actorOf};
