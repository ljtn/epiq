// Getting an image into a body being written: the picker, the drop and the
// paste all end here, upload, and leave the markdown reference at the cursor.
// Without that last step the affordance is worthless — the reference points at
// a content-hashed URL nobody is going to type by hand.

import {useCallback, useRef, useState} from 'react';

// What the blob store accepts. The real check is the magic bytes server-side;
// this only keeps the file picker from offering what would be refused.
export const IMAGE_FILE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

export const imageFilesFrom = (
	files: ArrayLike<File> | null | undefined,
): File[] =>
	files === null || files === undefined
		? []
		: Array.from(files).filter(file => file.type.startsWith('image/'));

// An image reads as its own block, so it is put on one. Only ever adds the
// newlines that are missing, so inserting into a blank body stays blank-clean
// and inserting mid-paragraph does not glue the picture to a word.
export const spliceImageMarkdown = (
	body: string,
	caret: number,
	markdown: string,
): {value: string; caret: number} => {
	const at = Math.max(0, Math.min(caret, body.length));
	const before = body.slice(0, at);
	const after = body.slice(at);

	const lead = before === '' || before.endsWith('\n') ? '' : '\n';
	const tail = after === '' || after.startsWith('\n') ? '' : '\n';
	const block = `${lead}${markdown}${tail}`;

	return {value: `${before}${block}${after}`, caret: at + block.length};
};

/**
 * Wires a textarea up to accept images. Returns the handlers to spread onto it
 * plus `pickFiles` for a button to call.
 *
 * `onUploadImages` resolves to one markdown reference per file it managed to
 * store, so a rejected file simply contributes nothing.
 */
export const useImageInsert = ({
	issueId,
	setValue,
	textareaRef,
	onUploadImages,
}: {
	issueId: string;
	setValue: (update: (current: string) => string) => void;
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
	onUploadImages?: (issueId: string, files: File[]) => Promise<string[]>;
}) => {
	const [dragging, setDragging] = useState(false);
	const [busy, setBusy] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const enabled = Boolean(onUploadImages);

	const insert = useCallback(
		async (files: File[]) => {
			if (!onUploadImages || files.length === 0) return;

			// Read now: the upload is a round trip, and by the time it lands the
			// textarea may have been typed in or blurred.
			const area = textareaRef.current;
			const caret = area ? area.selectionStart : Number.MAX_SAFE_INTEGER;

			setBusy(true);
			let markdown: string[] = [];
			try {
				markdown = await onUploadImages(issueId, files);
			} finally {
				setBusy(false);
			}

			if (markdown.length === 0) return;

			let nextCaret = caret;
			// Functional, so whatever was typed during the upload survives; the
			// caret is only clamped, which is the most that can be honoured.
			setValue(current => {
				const spliced = spliceImageMarkdown(
					current,
					caret,
					markdown.join('\n'),
				);
				nextCaret = spliced.caret;
				return spliced.value;
			});

			// After the value lands, or the browser puts the caret at the end.
			requestAnimationFrame(() => {
				const target = textareaRef.current;
				if (!target) return;
				target.focus();
				target.setSelectionRange(nextCaret, nextCaret);
			});
		},
		[issueId, onUploadImages, setValue, textareaRef],
	);

	return {
		enabled,
		dragging,
		busy,
		inputRef,
		pickFiles: () => inputRef.current?.click(),
		onInputChange: (event: React.ChangeEvent<HTMLInputElement>) => {
			void insert(imageFilesFrom(event.target.files));
			// Or picking the same file twice in a row fires no change event.
			event.target.value = '';
		},
		onDragOver: (event: React.DragEvent) => {
			if (!enabled) return;
			event.preventDefault();
			setDragging(true);
		},
		onDragLeave: () => setDragging(false),
		onDrop: (event: React.DragEvent) => {
			if (!enabled) return;
			event.preventDefault();
			setDragging(false);
			void insert(imageFilesFrom(event.dataTransfer.files));
		},
		onPaste: (event: React.ClipboardEvent) => {
			if (!enabled) return;

			const files = imageFilesFrom(
				Array.from(event.clipboardData.items)
					.filter(item => item.kind === 'file')
					.map(item => item.getAsFile())
					.filter((file): file is File => file !== null),
			);

			if (files.length === 0) return;

			// Only once there is an image to take: a plain text paste has to go
			// through untouched.
			event.preventDefault();
			void insert(files);
		},
	};
};
