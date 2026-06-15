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
			type: 'issue:assignee:add';
			payload: {issueId: string; assigneeName: string};
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
	  };
