import React from 'react';
import {Button} from './Button';
import {IconImage} from './IconImage';
import {IMAGE_FILE_ACCEPT} from '../lib/image-insert';

/**
 * The picker, as an icon and the hidden input it opens. Three surfaces take
 * images — a description, a comment, and the attachments list — and all three
 * want the same control, so it lives here rather than three times over.
 *
 * The label is a title and an aria-label rather than text: the button sits in
 * rows next to `save` and `cancel`, where a third word competes with the two
 * that decide something.
 */
export const AddImageButton = ({
	testId,
	busy = false,
	onPick,
	inputRef,
	onInputChange,
}: {
	testId: string;
	busy?: boolean;
	onPick: () => void;
	inputRef: React.RefObject<HTMLInputElement | null>;
	onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}) => (
	<>
		<Button
			variant="ghost"
			disabled={busy}
			title={busy ? 'Adding the image…' : 'Add an image'}
			aria-label="Add an image"
			onClick={onPick}
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				// Squared off, so the icon sits centred rather than in a word-shaped
				// box, and dimmed while the upload is in flight.
				padding: '4px 6px',
				opacity: busy ? 0.5 : 1,
			}}
		>
			<IconImage size={14} />
		</Button>

		<input
			data-testid={testId}
			ref={inputRef}
			type="file"
			accept={IMAGE_FILE_ACCEPT}
			multiple
			hidden
			onChange={onInputChange}
		/>
	</>
);
