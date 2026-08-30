import {useState} from 'react';
import {CONTENT_FONT, GUI_THEME, TEXT} from '../lib/gui-theme';
import {Button} from './Button';
import {CodeSnippet} from './CodeSnippet';
import {IconComment} from './IconComment';
import {ActionRow, Empty, Textarea} from './FormPrimitives';
import {GuiComment, GuiUser} from '../lib/gui-state.model';
import {timeAgo} from '../lib/gui-format.helper';
import {
	DiffLocation,
	diffLocationFromMeta,
	extractCommentLead,
	extractCommentSnippet,
	formatSelectionLabel,
	parseDiffCommentMeta,
	stripDiffCommentMarker,
	withDiffCommentNote,
} from './IssueCommits';
import {MarkdownContent} from './MarkdownContent';
import {MAX_COMMENT_LENGTH} from '../../../lib/utils/text.limits.js';

// A diff-selection comment's quoted code is rendered through the same
// highlighter the diff view uses, rather than as a markdown fence — the whole
// point of quoting it is that it reads as code. The note and the file/line
// caption are rebuilt from the marker's own metadata rather than sliced back
// out of the body, so the caption can be a real control rather than text.
// Also what a ticket filed from a selection shows as its description, so the
// two read the same and both link back to the diff.
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
		return <MarkdownContent content={withoutMarker} softBreaks />;
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
			{lead && <MarkdownContent content={lead} softBreaks />}

			{/* Only clickable when the marker recorded which commit the selection
			    came from — a file can appear in several of a ticket's commits, so
			    without it there is no unambiguous place to open. Comments written
			    before the sha was recorded stay readable, just inert. */}
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
}: Props) => {
	const [body, setBody] = useState('');
	// The comment being rewritten, if any. A diff-linked comment only exposes
	// its note here; the marker and quoted snippet ride along untouched.
	const [editing, setEditing] = useState<{id: string; text: string} | null>(
		null,
	);

	const startEditing = (comment: GuiComment) => {
		const meta = parseDiffCommentMeta(comment.body);
		setEditing({
			id: comment.id,
			text: meta ? extractCommentLead(comment.body) : comment.body,
		});
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
					{/* Same card as the annotation a comment gets inside a diff
					    (DiffCommentAnnotation), so the two read as one thing. */}
					{ordered.map(comment => (
						<div
							key={comment.id}
							style={{
								border: `1px solid ${GUI_THEME.line}`,
								borderLeft: `2px solid ${GUI_THEME.accent}`,
								borderRadius: 6,
								padding: '8px 10px',
								background: GUI_THEME.tertiary,
							}}
						>
							{/* Only the header carries the icon; the body runs the card's
							    full width underneath. */}
							<div
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 8,
									marginBottom: 6,
								}}
							>
								<span
									style={{
										display: 'inline-flex',
										color: GUI_THEME.accent,
										flexShrink: 0,
									}}
								>
									<IconComment size={12} />
								</span>
								<div
									style={{
										flex: 1,
										minWidth: 0,
										color: GUI_THEME.secondary,
										fontSize: TEXT.meta,
									}}
								>
									{comment.author.name ?? 'unknown'}
									{comment.createdAt && (
										<span style={{color: GUI_THEME.dim2}}>
											{' '}
											· {timeAgo(comment.createdAt)}
										</span>
									)}
								</div>

								{!readonly &&
									comment.author.id === whoAmI.id &&
									onEditComment &&
									editing?.id !== comment.id && (
										<Button
											variant="ghost"
											title="Edit comment"
											onClick={() => startEditing(comment)}
										>
											edit
										</Button>
									)}
								{!readonly &&
									comment.author.id === whoAmI.id &&
									onDeleteComment && (
										<Button
											variant="ghost"
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
										autoFocus
										maxLength={Number.MAX_SAFE_INTEGER}
										value={editing.text}
										placeholder="write a comment"
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
											minHeight: 45,
											font: 'inherit',
											fontFamily: CONTENT_FONT,
											fontSize: TEXT.prose,
										}}
									/>
									<ActionRow>
										<Button variant="ghost" onClick={() => setEditing(null)}>
											cancel
										</Button>
										<Button onClick={() => saveEdit(comment)}>save</Button>
									</ActionRow>
								</>
							) : (
								<CommentBody
									body={comment.body}
									onOpenDiffLocation={onOpenDiffLocation}
								/>
							)}
						</div>
					))}
				</div>
			)}

			{!readonly && (
				<div style={{marginTop: 20}}>
					<Textarea
						// Uncapped: maxLength drops a long paste's tail silently. The
						// counter and disabled button refuse it visibly instead.
						maxLength={Number.MAX_SAFE_INTEGER}
						value={body}
						placeholder="write a comment"
						onChange={event => setBody(event.target.value)}
						onKeyDown={event => {
							if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
								addComment();
							}
						}}
						style={{
							minHeight: 45,
							font: 'inherit',
							fontFamily: CONTENT_FONT,
							fontSize: TEXT.prose,
						}}
					/>

					<ActionRow>
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

						<Button disabled={tooLong} onClick={addComment}>
							comment
						</Button>
					</ActionRow>
				</div>
			)}
		</div>
	);
};
