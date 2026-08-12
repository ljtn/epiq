import {useState} from 'react';
import {CONTENT_FONT, GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {ActionRow, Empty, Textarea} from './FormPrimitives';
import {GuiComment, GuiUser} from '../lib/gui-state.model';
import {timeAgo} from '../lib/gui-format.helper';
import {MarkdownContent} from './MarkdownContent';

type Props = {
	issueId: string;
	readonly?: boolean;
	comments?: GuiComment[];
	whoAmI: GuiUser;
	onAddComment?: (issueId: string, body: string) => void;
	onDeleteComment?: (issueId: string, commentId: string) => void;
};

export const IssueComments = ({
	whoAmI,
	issueId,
	readonly = false,
	comments = [],
	onAddComment,
	onDeleteComment,
}: Props) => {
	const [body, setBody] = useState('');

	const addComment = () => {
		const nextBody = body.trim();
		if (!nextBody) return;

		onAddComment?.(issueId, nextBody);
		setBody('');
	};

	return (
		<div>
			{comments.length === 0 ? (
				<Empty>No comments</Empty>
			) : (
				<div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
					{comments.map(comment => (
						<div
							key={comment.id}
							style={{
								border: `1px solid ${GUI_THEME.line}`,
								borderRadius: 8,
								padding: 12,
								background: GUI_THEME.tertiary,
							}}
						>
							<div
								style={{
									display: 'flex',
									justifyContent: 'space-between',
									gap: 12,
									marginBottom: 8,
								}}
							>
								<div style={{color: GUI_THEME.secondary, fontSize: 11}}>
									{comment.author.name ?? 'unknown'}
									{comment.createdAt && (
										<span style={{color: GUI_THEME.dim2}}>
											{' '}
											· {timeAgo(comment.createdAt)}
										</span>
									)}
								</div>

								{comment.author.id === whoAmI.id && onDeleteComment && (
									<Button
										variant="ghost"
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

							<MarkdownContent content={comment.body} softBreaks />
						</div>
					))}
				</div>
			)}

			{!readonly && (
				<div style={{marginTop: 20}}>
					<Textarea
						maxLength={120}
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
							fontSize: 13,
						}}
					/>

					<ActionRow>
						<Button onClick={addComment}>comment</Button>
					</ActionRow>
				</div>
			)}
		</div>
	);
};
