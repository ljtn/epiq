import React, {useEffect, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {GuiAttachment} from '../lib/gui-state.model';
import {Empty} from './FormPrimitives';
import {Section} from './Section';

export type AttachmentUploadStatus =
	| {state: 'idle'}
	| {state: 'uploading'; name: string}
	| {state: 'error'; message: string};

export const IssueAttachments = ({
	issueId,
	readonly,
	attachments,
	uploadStatus,
	onUploadFiles,
}: {
	issueId: string;
	readonly: boolean;
	attachments: GuiAttachment[];
	uploadStatus: AttachmentUploadStatus;
	onUploadFiles?: (issueId: string, files: File[]) => void;
}) => {
	const [dragging, setDragging] = useState(false);
	const [lightbox, setLightbox] = useState<GuiAttachment | null>(null);

	useEffect(() => {
		setLightbox(null);
		setDragging(false);
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

	const handleDrop = (event: React.DragEvent) => {
		event.preventDefault();
		setDragging(false);

		if (!canUpload) return;

		const files = Array.from(event.dataTransfer.files).filter(file =>
			file.type.startsWith('image/'),
		);

		if (files.length > 0) onUploadFiles?.(issueId, files);
	};

	return (
		<Section
			title={`Attachments${
				attachments.length ? ` (${attachments.length})` : ''
			}`}
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
							<button
								key={attachment.id}
								type="button"
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
									cursor: 'zoom-in',
									overflow: 'hidden',
									width: 72,
									height: 72,
								}}
							>
								<img
									src={`/media/${attachment.fileName}`}
									alt={attachment.name}
									loading="lazy"
									style={{
										width: '100%',
										height: '100%',
										objectFit: 'cover',
										display: 'block',
									}}
								/>
							</button>
						))}
					</div>
				)}

				{canUpload && attachments.length > 0 && (
					<div
						style={{
							marginTop: 8,
							color: GUI_THEME.dim2,
							fontSize: 10,
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
							fontSize: 11,
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
							fontSize: 11,
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
						src={`/media/${lightbox.fileName}`}
						alt={lightbox.name}
						style={{
							maxWidth: '90vw',
							maxHeight: '85vh',
							borderRadius: 6,
							border: `1px solid ${GUI_THEME.line}`,
						}}
					/>
					<div style={{color: GUI_THEME.secondary, fontSize: 11}}>
						{lightbox.name} · {Math.max(1, Math.round(lightbox.bytes / 1024))}{' '}
						KB · esc to close
					</div>
				</div>
			)}
		</Section>
	);
};
