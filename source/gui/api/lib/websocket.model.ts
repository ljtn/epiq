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
			type: 'contributor:redact';
			payload: {contributorId: string};
	  }
	| {
			type: 'contributors:get';
			// Optional board scope: omit for everyone in the workspace.
			payload?: {boardId?: string};
	  }
	| {
			type: 'issue:assignee:add';
			// assigneeId assigns an existing contributor; assigneeName is the
			// unlinked fallback that creates one. See addIssueAssignee.
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
			// Omit boardId for every board — that is how the scrubber's
			// "all boards" toggle asks for an unscoped timeline.
			//
			// `requestId` is echoed back on the reply so the client can tell which
			// request it answers; the timeline and the commit log are requested as
			// a pair and rendered together.
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
			// No boardId: commits belong to the repository as a whole. See
			// `timeline:get` for what requestId is for.
			payload?: {start?: number; end?: number; requestId?: number};
	  }
	| {type: 'commit:inspect'; payload: {sha: string}};
