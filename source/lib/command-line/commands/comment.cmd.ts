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
	fileOfRow,
	parseLineAnchor,
	selectionFromLines,
} from '../../commits/patch-parse.js';
import {
	getOpenPatch,
	openPagerSha,
	setDiffMark,
} from '../../state/diff-pager.state.js';
import {buildDiffCommentBody} from '../../utils/diff-comment.js';

/**
 * The body to write, given what was typed.
 *
 * Inside the diff pager a leading `line:4` / `lines:4-9` names where the
 * comment attaches, and the rest is the note. The result is the same body the
 * GUI's composer writes, built by the same function so the two cannot drift.
 *
 * Only read as an anchor while the pager is open, so a comment that merely
 * begins "lines:3-4 are wrong" stays prose everywhere else.
 */
const resolveBody = (
	input: string,
): {ok: true; md: string; anchored: boolean} | {ok: false; reason: string} => {
	const note = input.trim();
	const sha = openPagerSha();
	const anchor = sha ? parseLineAnchor(note) : null;

	if (!sha || !anchor) return {ok: true, md: note, anchored: false};

	const patch = getOpenPatch();
	if (!patch || patch.sha !== sha)
		return {ok: false, reason: 'No diff is open'};

	const filePath = fileOfRow(patch.rows, Math.max(0, getState().selectedIndex));
	if (!filePath) return {ok: false, reason: 'That line is not in a file'};

	const selection = selectionFromLines(
		patch.rows,
		filePath,
		anchor.start,
		anchor.end,
	);
	if (!selection.ok) return {ok: false, reason: selection.reason};

	return {
		ok: true,
		anchored: true,
		md: buildDiffCommentBody({
			filePath: selection.value.filePath,
			start: selection.value.start,
			end: selection.value.end,
			// The pager anchors to the new revision and refuses anything else, so
			// both ends are always additions — see selectionFromRows.
			side: 'additions',
			endSide: 'additions',
			note: anchor.note,
			sha,
			snippet: selection.value.snippet,
		}),
	};
};

export const commentCommand = async (cmdState: CommandLineInput) => {
	const resolved = resolveBody(cmdState.inputString);
	if (!resolved.ok) return failed(resolved.reason);

	const {md, anchored} = resolved;

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
