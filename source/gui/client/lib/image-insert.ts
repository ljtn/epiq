// Picker, drop and paste all upload and leave the markdown reference at the
// cursor.

import {useCallback, useRef, useState} from 'react';
import {GUI_THEME} from './gui-theme';

// What the blob store accepts. The real check is the magic bytes server-side;
// this only keeps the file picker from offering what would be refused.
export const IMAGE_FILE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

// The dashed accent the Attachments section already shows while an image is
// over it, so the two drop targets read as the same thing.
const DROP_TARGET_TINT = 'rgba(118, 212, 255, 0.08)';

export const imageFilesFrom = (
	files: ArrayLike<File> | null | undefined,
): File[] =>
	files === null || files === undefined
		? []
		: Array.from(files).filter(file => file.type.startsWith('image/'));

// Puts the image on its own block, adding only the newlines missing.
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
 * Wires a textarea up to accept images: handlers to spread onto it, and
 * `pickFiles` for a button. A rejected file contributes nothing.
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
		// The drop target's look while an image is over it. The `border` shorthand,
		// since the Textarea sets it and mixing it with longhands warns.
		dropStyle: dragging
			? {
					border: `1px dashed ${GUI_THEME.accent}`,
					background: DROP_TARGET_TINT,
			  }
			: undefined,
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
