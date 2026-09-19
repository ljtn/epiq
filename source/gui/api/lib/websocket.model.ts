import {MovePosition} from '../../../lib/board/board-events.model.js';

export type GuiMessage =
	| {type: 'state:get'}
	| {type: 'project:open'; payload: {root: string}}
	| {type: 'issues:list'}
	| {type: 'issues:create'; payload: {title: string; parentId: string}}
	| {type: 'board:create'; payload: {title: string}}
	| {type: 'board:edit:title'; payload: {boardId: string; title: string}}
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
			// The description excerpt behind a ref's hover preview. Separate from
			// `issue:get` because a hover is not an opening: the client holds one
			// detail slot, for the ticket actually on screen.
			type: 'issue:preview:get';
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
	| {type: 'issue:commits:get'; payload: {issueId: string}}
	| {type: 'issue:squashed-diff:get'; payload: {issueId: string}}
	| {type: 'issue:stats:get'; payload: {issueId: string}}
	// Every ref's commit totals at once, for the bars on the cards. No payload:
	// like `commits:get` it is repository-wide, and unlike it, unwindowed — a
	// ticket's bar is what the ticket has come to, not what a scrubbed window
	// happens to hold.
	| {type: 'diff-stats:get'}
	| {type: 'swimlane:stats:get'; payload: {swimlaneId: string}}
	| {type: 'emails:get'}
	| {
			type: 'email:link';
			payload: {email: string; contributorId?: string};
	  }
	| {
			type: 'email:unlink';
			payload: {email: string; contributorId?: string};
	  }
	// The viewer's own totals, behind the same avatar. Asked for when the panel
	// opens rather than ridden along on the board's state: one of the four
	// figures is a walk over the repository's git history.
	| {type: 'me:stats:get'}
	// This machine's own preferences, not the board's: they live in
	// `~/.epiq/config.json` and reach no other clone. Which is why neither is a
	// mutating message — there is no event to refuse while history is being
	// read.
	| {type: 'settings:get'}
	| {
			// Whichever of the two the panel changed. Partial because the toggle
			// and the interval are separate controls over one file, and sending
			// both would have each overwrite what the other just did.
			type: 'settings:set';
			payload: {autoSync?: boolean; autoSyncIntervalMs?: number};
	  };
