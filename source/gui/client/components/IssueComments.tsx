import {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {Button} from './Button';
import {ActionRow, Empty, Textarea} from './FormPrimitives';

export type GuiIssueComment = {
	id: string;
	body: string;
	author?: string;
	createdAt?: string;
	readonly?: boolean;
};

type Props = {
	issueId: string;
	readonly?: boolean;
	comments?: GuiIssueComment[];
	onAddComment?: (issueId: string, body: string) => void;
	onDeleteComment?: (issueId: string, commentId: string) => void;
};

export const IssueComments = ({
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
			{!readonly && (
				<div style={{marginBottom: 18}}>
					<Textarea
						value={body}
						placeholder="write a comment"
						onChange={event => setBody(event.target.value)}
						onKeyDown={event => {
							if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
								addComment();
							}
						}}
						style={{minHeight: 90}}
					/>

					<ActionRow>
						<Button onClick={addComment}>comment</Button>
					</ActionRow>
				</div>
			)}

			{comments.length === 0 ? (
				<Empty>No comments</Empty>
			) : (
				<div style={{display: 'flex', flexDirection: 'column', gap: 12}}>
					{comments.map(comment => (
						<div
							key={comment.id}
							style={{
								border: `1px solid ${GUI_THEME.line}`,
								borderRadius: 12,
								padding: 12,
								background: GUI_THEME.bg,
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
								<div style={{color: GUI_THEME.secondary, fontSize: 10}}>
									{comment.author ?? 'unknown'}
									{comment.createdAt && (
										<span style={{color: GUI_THEME.dim}}>
											{' '}
											· {comment.createdAt}
										</span>
									)}
								</div>

								{!readonly && !comment.readonly && onDeleteComment && (
									<Button
										variant="ghost"
										onClick={() => onDeleteComment(issueId, comment.id)}
									>
										×
									</Button>
								)}
							</div>

							<div
								style={{
									whiteSpace: 'pre-wrap',
									lineHeight: 1.5,
									color: GUI_THEME.primary,
								}}
							>
								{comment.body}
							</div>
						</div>
					))}
				</div>
			)}
		</div>
	);
};
