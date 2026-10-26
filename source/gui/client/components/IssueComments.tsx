import {useEffect, useRef} from 'react';
import {GUI_THEME, PROSE, TEXT} from '../lib/gui-theme';
import {Button} from './Button';
import {CodeSnippet} from './CodeSnippet';
import {ActionRow, Empty, Textarea} from './FormPrimitives';
import {GuiComment, GuiUser} from '../lib/gui-state.model';
import {timeAgo} from '../lib/gui-format.helper';
import {CARD} from '../lib/card.style';
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
import {MAX_COMMENT_LENGTH} from '../../../lib/utils/text.limits.js';
import {useImageInsert} from '../lib/image-insert';
import {AddImageButton} from './AddImageButton';
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
	const [draft, setDraft] = useTicketDraft<string>(
		issueId,
		'comment',
		text => text !== '',
	);
	const body = draft ?? '';
	const setBody = (update: string | ((current: string) => string)) =>
		setDraft(current => {
			const next =
				typeof update === 'function' ? update(current ?? '') : update;
			return next === '' ? undefined : next;
		});
	const composerRef = useRef<HTMLTextAreaElement | null>(null);
	const focusedRef = useRef<HTMLDivElement | null>(null);

	// Runs once the card exists, which may be after the comments arrive.
	useEffect(() => {
		focusedRef.current?.scrollIntoView({block: 'center'});
	}, [focusedCommentId, issueId, comments]);

	const composerImages = useImageInsert({
		issueId,
		setValue: setBody,
		textareaRef: composerRef,
		onUploadImages: readonly ? undefined : onUploadImages,
	});
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
	useAutoGrow(composerRef, body, {maxHeight: AUTO_GROW_MAX_HEIGHT});
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

	// Trimmed, because that is what the server stores and measures.
	const length = body.trim().length;
	const tooLong = length > MAX_COMMENT_LENGTH;

	const addComment = () => {
		const nextBody = body.trim();
		if (!nextBody || tooLong) return;

		onAddComment?.(issueId, nextBody);
		setBody('');
	};

	// Newest first: the most recent activity is what a reader coming back to
	// a ticket wants to see without scrolling.
	const ordered = [...comments].sort(
		(a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0),
	);

	return (
		<div>
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
				// The composer: field and send row as one card.
				<div style={{...CARD, marginTop: 16, overflow: 'hidden'}}>
					<Textarea
						// Uncapped: maxLength drops a long paste's tail silently. The
						// counter and disabled button refuse it visibly instead.
						maxLength={Number.MAX_SAFE_INTEGER}
						ref={composerRef}
						value={body}
						placeholder="Write a comment"
						onChange={event => setBody(event.target.value)}
						onDragOver={composerImages.onDragOver}
						onDragLeave={composerImages.onDragLeave}
						onDrop={composerImages.onDrop}
						onPaste={composerImages.onPaste}
						onKeyDown={event => {
							if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
								addComment();
							}
						}}
						style={{
							minHeight: 64,
							...PROSE,
							// The card is the field's edge.
							border: 'none',
							borderRadius: 0,
							background: 'transparent',
							padding: '12px 14px',
							resize: 'none',
							...composerImages.dropStyle,
						}}
					/>

					<ActionRow
						style={{
							marginTop: 0,
							padding: '8px 10px',
							borderTop: `1px solid ${GUI_THEME.line}`,
						}}
					>
						{composerImages.enabled && (
							<AddImageButton
								testId="comment-image-input"
								busy={composerImages.busy}
								onPick={composerImages.pickFiles}
								inputRef={composerImages.inputRef}
								onInputChange={composerImages.onInputChange}
							/>
						)}

						{/* Hidden until halfway, so a one-liner is not nagged. */}
						{length > MAX_COMMENT_LENGTH / 2 && (
							<span
								style={{
									alignSelf: 'center',
									fontSize: TEXT.meta,
									color: tooLong ? GUI_THEME.red : GUI_THEME.dim,
								}}
							>
								{tooLong
									? `${length - MAX_COMMENT_LENGTH} over the limit`
									: `${MAX_COMMENT_LENGTH - length} left`}
							</span>
						)}

						<Button
							variant="primary"
							testId="comment-send"
							disabled={tooLong || !body.trim()}
							onClick={addComment}
						>
							Comment
						</Button>
					</ActionRow>
				</div>
			)}
		</div>
	);
};
