import React, {useEffect, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {useEditDraft} from '../lib/ticket-drafts';
import {Button} from './Button';
import {ConfirmModal} from './ConfirmModal';
import {ActionRow, Textarea} from './FormPrimitives';
import {IconInfo} from './IconInfo';
import {KebabMenu} from './KebabMenu';
import {MarkdownContent} from './MarkdownContent';

// A board's description: read from a popover beside its name, edited in a
// modal. Shown only where there is one, so a board without one carries no idle
// icon; the first one is written from the palette. A lane's lives in its panel.

export const NodeDescriptionPopover = ({
	description,
	title,
	testId,
	onEdit,
}: {
	description: string;
	title: string;
	testId: string;
	// Absent where the node is readonly.
	onEdit?: () => void;
}) => (
	<KebabMenu
		testId={testId}
		title={title}
		icon={<IconInfo />}
		portal
		popupRole="dialog"
	>
		{close => (
			<div
				data-testid={`${testId}-body`}
				// Clicks inside the text are reading, not leaving the header's drag.
				onMouseDown={event => event.stopPropagation()}
				style={{width: 320, maxHeight: 360, overflow: 'auto', padding: 6}}
			>
				<MarkdownContent content={description} />

				{onEdit && (
					<ActionRow>
						<Button
							type="button"
							variant="ghost"
							testId={`${testId}-edit`}
							onClick={() => {
								close();
								onEdit();
							}}
						>
							edit
						</Button>
					</ActionRow>
				)}
			</div>
		)}
	</KebabMenu>
);

export const NodeDescriptionModal = ({
	nodeId,
	eyebrow,
	current,
	maxLength,
	onSave,
	onClose,
}: {
	nodeId: string;
	eyebrow: string;
	current: string;
	maxLength: number;
	onSave: (description: string) => void;
	onClose: () => void;
}) => {
	// A draft that follows the description until it is touched, as a ticket's
	// does, so an edit landing from elsewhere is not overwritten unseen.
	const edit = useEditDraft(nodeId, 'description', current);
	const [confirmingDiscard, setConfirmingDiscard] = useState(false);
	const {editing, start} = edit;

	useEffect(() => {
		if (!editing) start();
	}, [editing, start]);

	const leave = () => {
		edit.stop();
		onClose();
	};

	const cancel = () => (edit.changed ? setConfirmingDiscard(true) : leave());

	const save = () => {
		const text = edit.text;
		edit.stop();
		onSave(text);
	};

	if (confirmingDiscard) {
		return (
			<ConfirmModal
				eyebrow="Unsaved"
				heading="Discard what you wrote?"
				body="This description has changes you have not saved."
				confirmLabel="discard"
				onConfirm={leave}
				onClose={() => setConfirmingDiscard(false)}
			/>
		);
	}

	return (
		<div
			style={{
				position: 'fixed',
				inset: 0,
				background: GUI_THEME.scrim,
				backdropFilter: 'blur(.5px)',
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				zIndex: 1000,
			}}
			onMouseDown={cancel}
		>
			<form
				data-testid="description-modal"
				onSubmit={event => {
					event.preventDefault();
					save();
				}}
				onMouseDown={event => event.stopPropagation()}
				style={{
					width: 480,
					background: GUI_THEME.panel,
					border: `1px solid ${GUI_THEME.line}`,
					borderRadius: 12,
					padding: 20,
				}}
			>
				<div
					style={{
						color: GUI_THEME.accent,
						fontSize: 10,
						marginBottom: 16,
						letterSpacing: 1,
						textTransform: 'uppercase',
					}}
				>
					{eyebrow}
				</div>

				<Textarea
					autoFocus
					data-testid="description-modal-input"
					placeholder="Conventions, in markdown"
					maxLength={maxLength}
					value={edit.text}
					onChange={event => edit.setText(event.target.value)}
					onKeyDown={event => {
						if (event.key === 'Escape') {
							event.preventDefault();
							cancel();
						}
						if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							save();
						}
					}}
					style={{minHeight: 200}}
				/>

				<ActionRow>
					<Button type="button" variant="ghost" onClick={cancel}>
						cancel
					</Button>
					<Button
						variant="primary"
						type="submit"
						testId="description-modal-save"
					>
						save
					</Button>
				</ActionRow>
			</form>
		</div>
	);
};
