import {AppEvent} from '../../lib/event/event.model.js';
import {AnyContext} from './context.model.js';

export type EmptyProps = Record<string, never>;

export type TicketProps = {
	description?: string;
	assignees?: string[];
	tags?: string[];
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
	BOARD: EmptyProps;
	SWIMLANE: EmptyProps;
	TICKET: TicketProps;
	FIELD: FieldProps;
	FIELD_LIST: EmptyProps;
	TEXT: TextProps;
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
