import {MovePosition} from '../../../lib/event/event.model.js';

export type GuiMessage =
	| {type: 'state:get'}
	| {type: 'issues:list'}
	| {type: 'issues:create'; payload: {title: string; parentId: string}}
	| {type: 'sync'}
	| {type: 'issue:edit:title'; payload: {issueId: string; title: string}}
	| {
			type: 'issue:edit:description';
			payload: {issueId: string; description: string};
	  }
	| {type: 'issue:tag:add'; payload: {issueId: string; tagName: string}}
	| {type: 'issue:tag:remove'; payload: {issueId: string; tagId: string}}
	| {
			type: 'contributor:remove';
			payload: {contributorId: string};
	  }
	| {
			type: 'contributors:get';
			// Optional board scope: omit for everyone in the workspace.
			payload?: {boardId?: string};
	  }
	| {
			type: 'issue:assignee:add';
			// assigneeId picks an existing contributor; assigneeName creates one.
			payload: {
				issueId: string;
				assigneeId?: string;
				assigneeName?: string;
				createUnlinked?: boolean;
			};
	  }
	| {
			type: 'issue:assignee:remove';
			payload: {issueId: string; assigneeId: string};
	  }
	| {
			type: 'issues:move';
			payload: {
				issueId: string;
				parentId: string;
				position?: MovePosition;
			};
	  }
	| {type: 'issue:close'; payload: {issueId: string}}
	| {type: 'issue:reopen'; payload: {issueId: string}}
	| {type: 'issue:comment:add'; payload: {issueId: string; body: string}}
	| {
			type: 'issue:comment:delete';
			payload: {issueId: string; commentId: string};
	  }
	| {
			type: 'timeline:get';
			// Omit boardId for every board. `requestId` is echoed on the reply so
			// the client can pair it with the matching commits reply.
			payload?: {
				start?: number;
				end?: number;
				boardId?: string;
				requestId?: number;
			};
	  }
	| {type: 'time-travel:scrub'; payload: {targetTime: number}}
	| {type: 'time-travel:live'}
	| {
			type: 'commits:get';
			// No boardId: commits are repository-wide.
			payload?: {start?: number; end?: number; requestId?: number};
	  }
	| {type: 'commit:inspect'; payload: {sha: string}};
