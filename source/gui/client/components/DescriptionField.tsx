import React, {useRef} from 'react';
import {GUI_THEME, PROSE} from '../lib/gui-theme';
import {useEditDraft} from '../lib/ticket-drafts';
import {AUTO_GROW_MAX_HEIGHT, useAutoGrow} from '../lib/use-auto-grow';
import {Button} from './Button';
import {CollapsibleBody} from './CollapsibleBody';
import {ActionRow, Empty, Textarea} from './FormPrimitives';
import {MarkdownContent} from './MarkdownContent';
import {Section} from './Section';

// A ticket's or a lane's description: read in a box, edited in place.
export const DescriptionField = ({
	draft,
	current,
	readonly,
	maxLength,
	onSave,
	collapseKey,
	testId = 'description',
	placeholder = '',
	textareaRef,
	textareaProps,
	extraActions,
	children,
}: {
	draft: ReturnType<typeof useEditDraft>;
	current: string;
	readonly: boolean;
	maxLength: number;
	onSave: (text: string) => void;
	// Opening another ticket or lane starts its description collapsed.
	collapseKey: string;
	testId?: string;
	placeholder?: string;
	textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
	textareaProps?: Pick<
		React.TextareaHTMLAttributes<HTMLTextAreaElement>,
		'onDragOver' | 'onDragLeave' | 'onDrop' | 'onPaste' | 'style'
	>;
	extraActions?: React.ReactNode;
	// How the description reads; markdown unless given.
	children?: React.ReactNode;
}) => {
	const ownRef = useRef<HTMLTextAreaElement | null>(null);
	const ref = textareaRef ?? ownRef;

	useAutoGrow(ref, draft.text, {
		active: draft.editing,
		maxHeight: AUTO_GROW_MAX_HEIGHT,
	});

	const save = () => {
		if (!readonly && draft.changed && draft.text !== current) {
			onSave(draft.text);
		}

		draft.stop();
	};

	const cancel = () => draft.stop();

	return (
		<Section
			first={true}
			title="Description"
			action={
				!readonly &&
				!draft.editing && (
					<Button
						variant="ghost"
						testId={`${testId}-edit`}
						onClick={draft.start}
					>
						edit
					</Button>
				)
			}
		>
			{draft.editing ? (
				<>
					<Textarea
						ref={ref}
						value={draft.text}
						autoFocus
						data-testid={`${testId}-input`}
						placeholder={placeholder}
						maxLength={maxLength}
						onChange={event => draft.setText(event.target.value)}
						onDragOver={textareaProps?.onDragOver}
						onDragLeave={textareaProps?.onDragLeave}
						onDrop={textareaProps?.onDrop}
						onPaste={textareaProps?.onPaste}
						onKeyDown={event => {
							if (event.key === 'Escape') return cancel();
							if (event.key !== 'Enter') return;

							// Enter confirms, so Shift+Enter is what a paragraph
							// break costs now. Cmd/Ctrl+Enter still confirms too,
							// which is what the comment boxes take.
							if (event.shiftKey) return;

							// An IME is mid-word: Enter is choosing a candidate,
							// not finishing the description. Committing here would
							// close the editor on a half-typed character.
							if (event.nativeEvent.isComposing) return;

							// Or the newline lands in the value on its way out.
							event.preventDefault();
							save();
						}}
						style={{
							...PROSE,
							resize: 'none',
							// The rendered box's own place and inset, so the text
							// stays where it was and only the ground changes: a
							// place to type, where a moment ago it was a thing read.
							marginTop: 8,
							padding: '8px 10px',
							borderRadius: 8,
							...textareaProps?.style,
						}}
					/>

					<ActionRow>
						{extraActions}
						<Button variant="ghost" onClick={cancel}>
							cancel
						</Button>
						<Button variant="primary" testId={`${testId}-save`} onClick={save}>
							save
						</Button>
					</ActionRow>
				</>
			) : current ? (
				<div
					data-testid={`${testId}-box`}
					title={readonly ? undefined : 'Double-click to edit'}
					style={{
						marginTop: 8,
						padding: '8px 10px',
						background: GUI_THEME.panel2,
						borderRadius: 8,
					}}
				>
					<CollapsibleBody
						key={collapseKey}
						testId={`${testId}-body`}
						onDoubleClick={event => {
							if (readonly) return;

							// A description carries links, images and the code
							// snippet's copy button. A double-click that landed
							// on one of those was aimed at it, not at editing.
							if (
								(event.target as HTMLElement).closest(
									'a, button, img, input, textarea, select',
								)
							)
								return;

							draft.start();
						}}
					>
						{children ?? <MarkdownContent content={current} />}
					</CollapsibleBody>
				</div>
			) : (
				<Empty>No description</Empty>
			)}
		</Section>
	);
};
