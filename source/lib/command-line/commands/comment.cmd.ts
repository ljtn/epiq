import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../board/board-log.js';
import {resolveActorId} from '../../board/board-log.js';
import {BreadCrumb, findInBreadCrumb} from '../../model/app-state.model.js';
import {isTicketNode} from '../../model/context.model.js';
import {failed, isFail, succeeded} from '../../model/result-types.js';
import {findAncestor} from '../../repository/node-repo.js';
import {getState} from '../../state/state.js';
import {MAX_COMMENT_LENGTH} from '../../utils/text.limits.js';
import {getPersistRoot} from '../../storage/paths.js';
import {CommandLineInput} from '../../model/action-map.model.js';
import {actorOf} from '../../event/event.model.js';
import {
	setDiffMark,
	takePendingDiffComment,
} from '../../state/diff-pager.state.js';
import {buildDiffCommentBody} from '../../utils/diff-comment.js';

export const commentCommand = async (cmdState: CommandLineInput) => {
	const note = cmdState.inputString.trim();

	// A comment started from the diff pager carries where it was made, so it
	// renders as the quoted lines rather than as loose prose — the same body
	// the GUI's composer writes, built by the same function so the two cannot
	// drift. Taken here rather than at the keystroke because the note is what
	// the command line was opened to collect.
	const anchored = takePendingDiffComment();

	const md = anchored
		? buildDiffCommentBody({
				filePath: anchored.selection.filePath,
				start: anchored.selection.start,
				end: anchored.selection.end,
				// The pager anchors to the new revision and refuses anything else,
				// so both ends are always additions — see selectionFromRows.
				side: 'additions',
				endSide: 'additions',
				note,
				sha: anchored.sha,
				snippet: anchored.selection.snippet,
		  })
		: note;

	// An anchored comment says something without a note: the quoted lines are
	// the point, and a bare one reads as "look at this".
	if (!md) return failed('Provide a comment');

	if (md.length > MAX_COMMENT_LENGTH)
		return failed(`Cannot exceed ${MAX_COMMENT_LENGTH} characters`);

	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {breadCrumb, selectedNode} = getState();
	const issueResult = findInBreadCrumb(
		[...breadCrumb, selectedNode] as BreadCrumb,
		'TICKET',
	);
	if (isFail(issueResult)) return failed('Edit target must be an issue');

	const target = issueResult.value;
	if (!target) return failed('Invalid comment target');

	const ticketResult =
		target.context === 'TICKET'
			? succeeded('Resolved ticket', target)
			: findAncestor(target.id, 'TICKET');

	if (isFail(ticketResult)) {
		return failed('Unable to comment on issue in this context');
	}

	const ticket = ticketResult.value;
	if (!isTicketNode(ticket)) return failed('Target node is not issue');

	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	const written = await materializeAndPersistAll(
		[
			{
				id: ulid(),
				action: 'add.issue.comment',
				payload: {
					id: ulid(),
					issue: ticket.id,
					author: userRes.value.userId,
					md,
				},
				...actorOf(userRes.value),
			},
		],
		persistRootResult.value,
	);

	// Only once it is written: a range that failed validation is one the writer
	// is about to retry, and clearing it would make them mark it again.
	if (anchored && !isFail(written)) setDiffMark(null);

	return written;
};
