import React from 'react';
import {IconButton, ICON_SIZE} from './IconButton';
import {IconImage} from './IconImage';
import {IMAGE_FILE_ACCEPT} from '../lib/image-insert';

// The image picker shared by descriptions, comments and attachments. Labelled
// by title rather than text, so it doesn't compete with `save` and `cancel`.
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
		<IconButton
			title={busy ? 'Adding the image…' : 'Add an image'}
			aria-label="Add an image"
			disabled={busy}
			onClick={onPick}
		>
			<IconImage size={ICON_SIZE} />
		</IconButton>

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
