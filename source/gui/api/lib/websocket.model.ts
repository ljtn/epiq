import {MovePosition} from '../../../lib/event/event.model.js';

export type GuiMessage =
	| {type: 'state:get'}
	| {type: 'project:open'; payload: {root: string}}
	| {type: 'issues:list'}
	| {type: 'issues:create'; payload: {title: string; parentId: string}}
	| {type: 'swimlane:create'; payload: {title: string; boardId: string}}
	| {type: 'swimlane:edit:title'; payload: {swimlaneId: string; title: string}}
	| {type: 'swimlane:delete'; payload: {swimlaneId: string}}
	| {
			type: 'swimlane:move';
			payload: {swimlaneId: string; boardId: string; position?: MovePosition};
	  }
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
	| {type: 'tag:remove'; payload: {tagId: string}}
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
			type: 'issue:comment:edit';
			payload: {issueId: string; commentId: string; body: string};
	  }
	| {
			// The description and comment bodies the board's state leaves out.
			type: 'issue:get';
			payload: {issueId: string};
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
	| {type: 'time-travel:checkout-event'; payload: {eventId: string}}
	| {type: 'time-travel:live'}
	| {
			type: 'commits:get';
			// No boardId: commits are repository-wide.
			payload?: {start?: number; end?: number; requestId?: number};
	  }
	| {type: 'commit:inspect'; payload: {sha: string}}
	| {type: 'commit:diff:get'; payload: {sha: string}}
	| {type: 'issue:commits:get'; payload: {issueId: string}};
