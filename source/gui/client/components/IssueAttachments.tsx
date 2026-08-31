import React, {useEffect, useRef, useState} from 'react';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {GuiAttachment} from '../lib/gui-state.model';
import {Empty} from './FormPrimitives';
import {Section} from './Section';
import {getAttachmentUrl} from '../../../lib/media/attachment-url.js';
import {imageFilesFrom} from '../lib/image-insert';
import {AddImageButton} from './AddImageButton';

export type AttachmentUploadStatus =
	| {state: 'idle'}
	| {state: 'uploading'; name: string}
	| {state: 'error'; message: string};

// It sits on top of whatever was uploaded, so it cannot borrow contrast from
// what is behind it. The dark fill carries it over a pale photo, the light ring
// carries it over a dark one, and the shadow lifts it off a busy one — a 16px
// dim × in the corner disappeared into all three.
const DeleteAttachmentButton = ({onDelete}: {onDelete: () => void}) => {
	const [hovered, setHovered] = useState(false);

	return (
		<button
			type="button"
			title="Delete attachment"
			aria-label="Delete attachment"
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			onClick={onDelete}
			style={{
				position: 'absolute',
				top: 3,
				right: 3,
				width: 18,
				height: 18,
				lineHeight: '16px',
				padding: 0,
				border: `1px solid ${
					hovered ? GUI_THEME.red : 'rgba(255, 255, 255, 0.5)'
				}`,
				borderRadius: 4,
				background: hovered ? GUI_THEME.red : 'rgba(4, 5, 8, 0.85)',
				// Full strength rather than the dim secondary: this is the one mark
				// that has to survive whatever it is sitting on.
				color: '#fff',
				fontSize: TEXT.label,
				boxShadow: '0 1px 4px rgba(0, 0, 0, 0.65)',
				cursor: 'pointer',
			}}
		>
			×
		</button>
	);
};

export const IssueAttachments = ({
	issueId,
	readonly,
	attachments,
	uploadStatus,
	onUploadFiles,
	onDeleteAttachment,
}: {
	issueId: string;
	readonly: boolean;
	attachments: GuiAttachment[];
	uploadStatus: AttachmentUploadStatus;
	onUploadFiles?: (issueId: string, files: File[]) => void;
	onDeleteAttachment?: (issueId: string, attachmentId: string) => void;
}) => {
	const [dragging, setDragging] = useState(false);
	const [lightbox, setLightbox] = useState<GuiAttachment | null>(null);
	const [broken, setBroken] = useState<Record<string, boolean>>({});
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		setLightbox(null);
		setDragging(false);
		setBroken({});
	}, [issueId]);

	useEffect(() => {
		if (!lightbox) return;

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setLightbox(null);
		};

		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [lightbox]);

	const canUpload = !readonly && Boolean(onUploadFiles);

	const upload = (files: File[]) => {
		if (files.length > 0) onUploadFiles?.(issueId, files);
	};

	const handleDrop = (event: React.DragEvent) => {
		event.preventDefault();
		setDragging(false);

		if (!canUpload) return;

		upload(imageFilesFrom(event.dataTransfer.files));
	};

	return (
		<Section
			title={`Attachments${
				attachments.length ? ` (${attachments.length})` : ''
			}`}
			action={
				canUpload && (
					<AddImageButton
						testId="attachment-image-input"
						busy={uploadStatus.state === 'uploading'}
						onPick={() => fileInputRef.current?.click()}
						inputRef={fileInputRef}
						onInputChange={event => {
							upload(imageFilesFrom(event.target.files));
							// Or re-picking the same file fires no change event.
							event.target.value = '';
						}}
					/>
				)
			}
		>
			<div
				onDragOver={event => {
					if (!canUpload) return;
					event.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={handleDrop}
				style={{
					marginTop: 8,
					padding: dragging ? 10 : 0,
					border: dragging
						? `1px dashed ${GUI_THEME.accent}`
						: '1px dashed transparent',
					borderRadius: 4,
					transition: 'padding 0.12s ease, border-color 0.12s ease',
				}}
			>
				{attachments.length === 0 ? (
					<Empty>
						{canUpload
							? 'No attachments — drop an image here'
							: 'No attachments'}
					</Empty>
				) : (
					<div
						style={{
							display: 'flex',
							flexWrap: 'wrap',
							gap: 8,
						}}
					>
						{attachments.map(attachment => (
							<div
								key={attachment.id}
								style={{position: 'relative', width: 72, height: 72}}
							>
								<button
									type="button"
									disabled={broken[attachment.id]}
									onClick={() => setLightbox(attachment)}
									title={`${attachment.name} (${Math.max(
										1,
										Math.round(attachment.bytes / 1024),
									)} KB)`}
									style={{
										padding: 0,
										border: `1px solid ${GUI_THEME.line}`,
										borderRadius: 4,
										background: GUI_THEME.panel2,
										cursor: broken[attachment.id] ? 'default' : 'zoom-in',
										overflow: 'hidden',
										width: '100%',
										height: '100%',
									}}
								>
									{broken[attachment.id] ? (
										<span
											title="Attachment unavailable (missing, corrupt, or over the size cap)"
											style={{
												display: 'flex',
												alignItems: 'center',
												justifyContent: 'center',
												width: '100%',
												height: '100%',
												color: GUI_THEME.dim2,
												fontSize: TEXT.label,
												padding: 4,
												textAlign: 'center',
											}}
										>
											unavailable
										</span>
									) : (
										<img
											src={getAttachmentUrl(attachment.fileName)}
											alt={attachment.name}
											loading="lazy"
											onError={() =>
												setBroken(prev => ({...prev, [attachment.id]: true}))
											}
											style={{
												width: '100%',
												height: '100%',
												objectFit: 'cover',
												display: 'block',
											}}
										/>
									)}
								</button>

								{attachment.canDelete && !readonly && onDeleteAttachment && (
									<DeleteAttachmentButton
										onDelete={() => onDeleteAttachment(issueId, attachment.id)}
									/>
								)}
							</div>
						))}
					</div>
				)}

				{canUpload && attachments.length > 0 && (
					<div
						style={{
							marginTop: 8,
							color: GUI_THEME.dim2,
							fontSize: TEXT.label,
						}}
					>
						drop an image to attach
					</div>
				)}

				{uploadStatus.state === 'uploading' && (
					<div
						style={{
							marginTop: 8,
							color: GUI_THEME.secondary,
							fontSize: TEXT.meta,
						}}
					>
						uploading {uploadStatus.name}…
					</div>
				)}

				{uploadStatus.state === 'error' && (
					<div
						style={{
							marginTop: 8,
							color: GUI_THEME.red,
							fontSize: TEXT.meta,
						}}
					>
						{uploadStatus.message}
					</div>
				)}
			</div>

			{lightbox && (
				<div
					onClick={() => setLightbox(null)}
					style={{
						position: 'fixed',
						inset: 0,
						zIndex: 100,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						flexDirection: 'column',
						gap: 10,
						background: 'rgba(4, 5, 8, 0.88)',
						cursor: 'zoom-out',
					}}
				>
					<img
						src={getAttachmentUrl(lightbox.fileName)}
						alt={lightbox.name}
						style={{
							maxWidth: '90vw',
							maxHeight: '85vh',
							borderRadius: 6,
							border: `1px solid ${GUI_THEME.line}`,
						}}
					/>
					<div style={{color: GUI_THEME.secondary, fontSize: TEXT.meta}}>
						{lightbox.name} · {Math.max(1, Math.round(lightbox.bytes / 1024))}{' '}
						KB · esc to close
					</div>
				</div>
			)}
		</Section>
	);
};
