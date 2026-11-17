import {useEffect, useLayoutEffect, useRef} from 'react';

/** The nearest ancestor that scrolls vertically: the tab body, not ours. */
const scrollParentOf = (element: HTMLElement): HTMLElement | null => {
	for (let node = element.parentElement; node; node = node.parentElement) {
		const {overflowY} = getComputedStyle(node);
		if (overflowY === 'auto' || overflowY === 'scroll') return node;
	}

	return null;
};
import {GUI_THEME, PROSE, TEXT} from '../lib/gui-theme';
import {Button} from './Button';
import {CodeSnippet} from './CodeSnippet';
import {ActionRow, Empty, Textarea} from './FormPrimitives';
import {GuiComment, GuiUser} from '../lib/gui-state.model';
import {formatAbsolute, timeAgo} from '../lib/gui-format.helper';
import {
	COMMENT_CARD_FOCUSED_STYLE,
	COMMENT_CARD_STYLE,
} from '../lib/comment-card.style';
import {DiffLocation, diffLocationFromMeta} from '../lib/diff-selection';
import {
	extractCommentLead,
	extractCommentSnippet,
	formatSelectionLabel,
	parseDiffCommentMeta,
	stripDiffCommentMarker,
	withDiffCommentNote,
} from '../../../lib/utils/diff-comment.js';
import {MarkdownContent} from './MarkdownContent';
import {CommentComposer} from './CommentComposer';
import {useTicketDraft} from '../lib/ticket-drafts';
import {AUTO_GROW_MAX_HEIGHT, useAutoGrow} from '../lib/use-auto-grow';

// A diff-selection comment: the quote highlighted as code, the caption a link
// built from the marker's metadata. Also a selection-filed ticket's description.
export const CommentBody = ({
	body,
	onOpenDiffLocation,
}: {
	body: string;
	onOpenDiffLocation?: (location: DiffLocation) => void;
}) => {
	const meta = parseDiffCommentMeta(body);
	const withoutMarker = stripDiffCommentMarker(body);
	const snippet = meta && extractCommentSnippet(withoutMarker);

	if (!meta || !snippet) {
		return <MarkdownContent content={withoutMarker} />;
	}

	const location = diffLocationFromMeta(meta);
	const lead = extractCommentLead(body);
	const caption = `${meta.issueRef ? `${meta.issueRef} · ` : ''}${
		meta.filePath
	} ${formatSelectionLabel(meta)}`;

	return (
		// A flex column: sibling margins don't collapse here, so the gap between
		// note and snippet is the gap it says it is.
		<div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
			{lead && <MarkdownContent content={lead} />}

			{/* Clickable only when the marker names its commit; older comments stay inert. */}
			<CodeSnippet
				filePath={meta.filePath}
				snippet={snippet}
				caption={caption}
				sha={meta.sha}
				// A range crossing from deletions into additions quotes both halves,
				// which no single run of numbers describes.
				startLine={meta.side === meta.endSide ? meta.start : undefined}
				onOpen={
					location && onOpenDiffLocation
						? () => onOpenDiffLocation(location)
						: undefined
				}
			/>
		</div>
	);
};

type Props = {
	issueId: string;
	readonly?: boolean;
	comments?: GuiComment[];
	whoAmI: GuiUser;
	onAddComment?: (issueId: string, body: string) => void;
	onDeleteComment?: (issueId: string, commentId: string) => void;
	onEditComment?: (issueId: string, commentId: string, body: string) => void;
	onOpenDiffLocation?: (location: DiffLocation) => void;
	// Resolves to one markdown reference per stored file, left at the cursor.
	onUploadImages?: (issueId: string, files: File[]) => Promise<string[]>;
	// The comment a link points at, scrolled to and marked.
	focusedCommentId?: string | null;
};

export const IssueComments = ({
	whoAmI,
	issueId,
	readonly = false,
	comments = [],
	onAddComment,
	onDeleteComment,
	onEditComment,
	onOpenDiffLocation,
	onUploadImages,
	focusedCommentId = null,
}: Props) => {
	const focusedRef = useRef<HTMLDivElement | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);
	// Whether the panel follows the end of the thread: true on open and while
	// the reader stays at the bottom, false once they scroll up to read.
	const pinnedRef = useRef(true);

	// Runs once the card exists, which may be after the comments arrive.
	useEffect(() => {
		focusedRef.current?.scrollIntoView({block: 'center'});
	}, [focusedCommentId, issueId, comments]);

	// Opens at the thread's end and holds it while late images or new comments
	// grow it. A link to one comment wins.
	useLayoutEffect(() => {
		const root = rootRef.current;
		const scroller = root ? scrollParentOf(root) : null;
		if (!root || !scroller) return;

		pinnedRef.current = !focusedCommentId;
		const toBottom = () => {
			if (pinnedRef.current) scroller.scrollTop = scroller.scrollHeight;
		};
		const onScroll = () => {
			const gap =
				scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
			pinnedRef.current = gap < 24;
		};

		toBottom();
		const observer = new ResizeObserver(toBottom);
		observer.observe(root);
		scroller.addEventListener('scroll', onScroll, {passive: true});

		return () => {
			observer.disconnect();
			scroller.removeEventListener('scroll', onScroll);
		};
	}, [issueId, focusedCommentId]);

	// The comment being rewritten, if any. A diff-linked comment only exposes
	// its note here; the marker and quoted snippet ride along untouched.
	const [editingDraft, setEditingDraft] = useTicketDraft<{
		id: string;
		text: string;
		original: string;
	}>(issueId, 'edit', edit => edit.text !== edit.original);
	const editing = editingDraft ?? null;
	const setEditing = (next: {id: string; text: string} | null) =>
		setEditingDraft(current =>
			next ? {original: current?.original ?? next.text, ...next} : undefined,
		);

	const editRef = useRef<HTMLTextAreaElement | null>(null);
	useAutoGrow(editRef, editing?.text ?? '', {
		active: Boolean(editing),
		maxHeight: AUTO_GROW_MAX_HEIGHT,
	});

	const startEditing = (comment: GuiComment) => {
		const meta = parseDiffCommentMeta(comment.body);
		const text = meta ? extractCommentLead(comment.body) : comment.body;
		setEditingDraft({id: comment.id, text, original: text});
	};

	const saveEdit = (comment: GuiComment) => {
		if (!editing || !onEditComment) return;

		const next =
			withDiffCommentNote(comment.body, editing.text) ?? editing.text.trim();
		if (next && next !== comment.body) onEditComment(issueId, comment.id, next);

		setEditing(null);
	};

	const addComment = (body: string) => {
		onAddComment?.(issueId, body);
		// Your own comment lands at the end; follow it there.
		pinnedRef.current = true;
	};

	// Oldest first, read top to bottom like the TUI. The panel opens scrolled
	// to the end, so the newest comment still needs no scroll.
	const ordered = [...comments].sort(
		(a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0),
	);

	return (
		<div ref={rootRef}>
			{comments.length === 0 ? (
				<Empty>No comments</Empty>
			) : (
				<div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
					{ordered.map(comment => {
						const focused = comment.id === focusedCommentId;

						return (
							<div
								key={comment.id}
								ref={focused ? focusedRef : undefined}
								data-testid={focused ? 'comment-card-focused' : undefined}
								style={
									focused ? COMMENT_CARD_FOCUSED_STYLE : COMMENT_CARD_STYLE
								}
							>
								{/* One line over the body: who, and at the far end when. The
								    body runs the card's full width underneath. */}
								<div
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: 8,
										marginBottom: 8,
									}}
								>
									<div
										style={{
											flex: 1,
											minWidth: 0,
											color: GUI_THEME.secondary,
											fontSize: TEXT.meta,
											overflow: 'hidden',
											textOverflow: 'ellipsis',
											whiteSpace: 'nowrap',
										}}
									>
										{comment.author.name ?? 'unknown'}
									</div>
									{comment.createdAt && (
										<span
											data-testid="comment-created-at"
											title={formatAbsolute(comment.createdAt)}
											style={{
												color: GUI_THEME.dim,
												fontSize: TEXT.meta,
												whiteSpace: 'nowrap',
											}}
										>
											{timeAgo(comment.createdAt)}
										</span>
									)}

									{!readonly &&
										comment.author.id === whoAmI.id &&
										onEditComment &&
										editing?.id !== comment.id && (
											<Button
												variant="ghost"
												testId="edit-comment"
												onClick={() => startEditing(comment)}
											>
												Edit
											</Button>
										)}
									{!readonly &&
										comment.author.id === whoAmI.id &&
										onDeleteComment && (
											<Button
												variant="ghost"
												testId="delete-comment"
												title="Delete comment"
												onClick={event => {
													event.preventDefault();
													event.stopPropagation();
													onDeleteComment(issueId, comment.id);
												}}
											>
												×
											</Button>
										)}
								</div>

								{editing?.id === comment.id ? (
									<>
										<Textarea
											ref={editRef}
											data-testid="comment-editor"
											autoFocus
											maxLength={Number.MAX_SAFE_INTEGER}
											value={editing.text}
											placeholder="Write a comment"
											onChange={event =>
												setEditing({id: comment.id, text: event.target.value})
											}
											onKeyDown={event => {
												if (event.key === 'Escape') setEditing(null);
												if (
													(event.metaKey || event.ctrlKey) &&
													event.key === 'Enter'
												) {
													saveEdit(comment);
												}
											}}
											style={{
												// In place: the card is the edge, and the text keeps
												// the metrics it had a moment ago.
												minHeight: 64,
												...PROSE,
												border: 'none',
												borderRadius: 0,
												background: 'transparent',
												padding: 0,
												resize: 'none',
											}}
										/>
										<ActionRow>
											<Button variant="ghost" onClick={() => setEditing(null)}>
												Cancel
											</Button>
											<Button
												variant="primary"
												onClick={() => saveEdit(comment)}
											>
												Save
											</Button>
										</ActionRow>
									</>
								) : (
									<CommentBody
										body={comment.body}
										onOpenDiffLocation={onOpenDiffLocation}
									/>
								)}
							</div>
						);
					})}
				</div>
			)}

			{!readonly && (
				// Sticky: it ends the thread, and holds the panel's floor when the
				// reader scrolls up, so a reply never needs a scroll back down.
				<div
					style={{
						position: 'sticky',
						bottom: 0,
						zIndex: 1,
						paddingTop: 16,
						background: GUI_THEME.panel,
					}}
				>
					<CommentComposer
						issueId={issueId}
						onSend={addComment}
						onUploadImages={onUploadImages}
					/>
				</div>
			)}
		</div>
	);
};
