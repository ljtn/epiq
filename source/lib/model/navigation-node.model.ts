import {AppEvent} from '../../lib/board/board-events.model.js';
import {AnyContext} from './context.model.js';

export type EmptyProps = Record<string, never>;

export type TicketProps = {
	// Shorthand reference derived from the ULID tail
	ref?: string;
	description?: string;
	assignees?: string[];
	tags?: string[];
	// The ticket standing for the goal this one belongs to.
	goal?: string;
	// A `#rrggbb` its goal's tickets are marked in, when it is one.
	color?: string;
};

export type BoardProps = {
	// Shorthand reference derived from the ULID tail
	ref?: string;
	// The board's conventions, as markdown
	description?: string;
};

export type SwimlaneProps = {
	// The lane's conventions, as markdown
	description?: string;
};

export type FieldProps = {
	value?: string;
};

export type TextProps = {
	value?: string;
	disabled?: boolean;
};

export type NavNodePropsMap = {
	WORKSPACE: EmptyProps;
	BOARD: BoardProps;
	SWIMLANE: SwimlaneProps;
	TICKET: TicketProps;
	FIELD: FieldProps;
	FIELD_LIST: EmptyProps;
	TEXT: TextProps;
	COMMENT: FieldProps;
};

export type NavNodeProps<U extends AnyContext> = NavNodePropsMap[U];

export type NavNode<U extends AnyContext> = {
	id: string;
	title: string;
	isDeleted: boolean;
	props: NavNodeProps<U>;
	context: U;
	parentNodeId: string | null;
	rank: string;
	childRenderAxis: 'vertical' | 'horizontal';
	childNavigationAcrossParents?: boolean;
	readonly: boolean;
	log: AppEvent[];
	isVirtual?: boolean;
};
