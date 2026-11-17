import {useRef} from 'react';
import {GUI_THEME, PROSE, TEXT} from '../lib/gui-theme';
import {CARD} from '../lib/card.style';
import {useImageInsert} from '../lib/image-insert';
import {useTicketDraft} from '../lib/ticket-drafts';
import {useAutoGrow} from '../lib/use-auto-grow';
import {MAX_COMMENT_LENGTH} from '../../../lib/utils/text.limits.js';
import {AddImageButton} from './AddImageButton';
import {Button} from './Button';
import {ActionRow, Textarea} from './FormPrimitives';

// Lower than the editor's: the composer stays on screen, under the thread.
const COMPOSER_MAX_HEIGHT = 200;

type Props = {
	issueId: string;
	onSend: (body: string) => void;
	// Resolves to one markdown reference per stored file, left at the cursor.
	onUploadImages?: (issueId: string, files: File[]) => Promise<string[]>;
};

/** A new comment's field and send row, as one card. Where it sits is the caller's. */
export const CommentComposer = ({issueId, onSend, onUploadImages}: Props) => {
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

	const fieldRef = useRef<HTMLTextAreaElement | null>(null);
	useAutoGrow(fieldRef, body, {maxHeight: COMPOSER_MAX_HEIGHT});
	const images = useImageInsert({
		issueId,
		setValue: setBody,
		textareaRef: fieldRef,
		onUploadImages,
	});

	// Trimmed, because that is what the server stores and measures.
	const length = body.trim().length;
	const tooLong = length > MAX_COMMENT_LENGTH;

	const send = () => {
		const nextBody = body.trim();
		if (!nextBody || tooLong) return;

		onSend(nextBody);
		setBody('');
	};

	return (
		<div style={{...CARD, overflow: 'hidden'}}>
			<Textarea
				// Uncapped: maxLength drops a long paste's tail silently. The
				// counter and disabled button refuse it visibly instead.
				maxLength={Number.MAX_SAFE_INTEGER}
				ref={fieldRef}
				data-testid="comment-composer"
				value={body}
				placeholder="Write a comment"
				onChange={event => setBody(event.target.value)}
				onDragOver={images.onDragOver}
				onDragLeave={images.onDragLeave}
				onDrop={images.onDrop}
				onPaste={images.onPaste}
				onKeyDown={event => {
					if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
						send();
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
					...images.dropStyle,
				}}
			/>

			<ActionRow
				style={{
					marginTop: 0,
					padding: '8px 10px',
					borderTop: `1px solid ${GUI_THEME.line}`,
				}}
			>
				{images.enabled && (
					<AddImageButton
						testId="comment-image-input"
						busy={images.busy}
						onPick={images.pickFiles}
						inputRef={images.inputRef}
						onInputChange={images.onInputChange}
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
					onClick={send}
				>
					Comment
				</Button>
			</ActionRow>
		</div>
	);
};
