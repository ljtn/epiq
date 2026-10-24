// The header's version. Quiet text while this is the latest epiq; once a newer
// one is out, the same text with an accent arrow, opening what changed and how
// to update. Releases come often, so it says no more than that.

import {useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {UpdateInfo} from '../../../lib/version/version.model.js';
import {formatAbsolute, timeAgo} from '../lib/gui-format.helper';
import {GUI_THEME, MONO_FONT, SANS_FONT} from '../lib/gui-theme';
import {popoverStyle} from '../lib/select-style';
import {segmentedButtonStyle} from '../lib/segmented.style';
import {useDismissOnOutsideClick} from '../lib/use-dismiss-on-outside-click';
import {Button} from './Button';
import {CopyButton} from './CopyButton';
import {IconArrowUpRight} from './IconArrowUpRight';
import {usePortalAnchor} from './Menu';

export const VersionBadge = ({
	current,
	update,
}: {
	current: string;
	update: (UpdateInfo & {latest: string}) | null;
}) => {
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const popoverRef = useRef<HTMLDivElement | null>(null);
	const ref = useDismissOnOutsideClick(open, () => setOpen(false), [
		popoverRef,
	]);
	// Out to the body: the header clips what hangs below it.
	const anchor = usePortalAnchor(open, triggerRef, popoverRef);

	if (!update) {
		return (
			<span data-testid="version" style={{color: GUI_THEME.dim}}>
				{'v' + current}
			</span>
		);
	}

	return (
		<div ref={ref} style={{position: 'relative', display: 'inline-flex'}}>
			<Button
				ref={triggerRef}
				variant="ghost"
				testId="version-update"
				aria-expanded={open}
				aria-haspopup="dialog"
				onClick={() => setOpen(!open)}
				title={`epiq ${update.latest} is out`}
				style={{
					fontSize: 11,
					fontFamily: MONO_FONT,
					display: 'inline-flex',
					alignItems: 'center',
					gap: 5,
					color: GUI_THEME.dim,
				}}
			>
				<span>{'v' + current}</span>
				<span style={{color: GUI_THEME.accent, display: 'inline-flex'}}>
					<IconArrowUpRight size={10} />
				</span>
			</Button>

			{open &&
				createPortal(
					<UpdatePopover ref={popoverRef} update={update} position={anchor} />,
					document.body,
				)}
		</div>
	);
};

const releaseVersionStyle: React.CSSProperties = {
	color: GUI_THEME.secondary,
	fontFamily: MONO_FONT,
	fontSize: 12,
};

const UpdatePopover = ({
	ref,
	update,
	position,
}: {
	ref: React.RefObject<HTMLDivElement | null>;
	update: UpdateInfo & {latest: string};
	position: {left: number; top: number} | null;
}) => (
	<div
		ref={ref}
		role="dialog"
		aria-label={`epiq ${update.latest}`}
		data-testid="version-popover"
		style={{
			...popoverStyle,
			position: 'fixed',
			left: position?.left ?? 0,
			top: position?.top ?? 0,
			marginTop: 0,
			// Placed once it has a size to place.
			visibility: position ? 'visible' : 'hidden',
			width: 420,
			padding: 0,
			gap: 0,
			whiteSpace: 'normal',
			fontFamily: SANS_FONT,
			cursor: 'default',
		}}
	>
		<div style={{padding: '14px 16px 12px'}}>
			<div style={{display: 'flex', alignItems: 'baseline', gap: 8}}>
				<span style={{color: GUI_THEME.primary, fontSize: 14, fontWeight: 600}}>
					{update.current}
				</span>
				{update.currentPublishedAt && (
					<span
						data-testid="version-current-age"
						title={formatAbsolute(Date.parse(update.currentPublishedAt))}
						style={{color: GUI_THEME.faint, fontSize: 11}}
					>
						Released {timeAgo(Date.parse(update.currentPublishedAt))}
					</span>
				)}
			</div>
		</div>

		<div
			data-testid="version-releases"
			style={{
				maxHeight: 'min(480px, 60vh)',
				overflowY: 'auto',
				// Set back from the popover's own ground, as reading matter.
				background: GUI_THEME.panel,
				borderTop: `1px solid ${GUI_THEME.line}`,
				padding: '0 16px',
			}}
		>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 6,
					color: GUI_THEME.primary,
					fontSize: 12,
					fontWeight: 600,
					paddingTop: 12,
					// Alone when the notes could not be fetched.
					paddingBottom: update.releases.length > 0 ? 0 : 12,
				}}
			>
				{/* The header's arrow, so the line reads as what it pointed at. */}
				<span style={{color: GUI_THEME.accent, display: 'inline-flex'}}>
					<IconArrowUpRight size={11} />
				</span>
				Epiq {update.latest} is available
			</div>
			{update.releases.map((release, i) => (
				<section
					key={release.version}
					style={{
						padding: '12px 0',
						borderTop: i > 0 ? `1px solid ${GUI_THEME.line}` : 'none',
					}}
				>
					<div
						style={{
							display: 'flex',
							alignItems: 'baseline',
							justifyContent: 'space-between',
							gap: 8,
						}}
					>
						{release.url ? (
							<a
								href={release.url}
								target="_blank"
								rel="noreferrer"
								style={{...releaseVersionStyle, textDecoration: 'none'}}
							>
								{release.version}
							</a>
						) : (
							<span style={releaseVersionStyle}>{release.version}</span>
						)}
						{release.publishedAt && (
							<span
								title={formatAbsolute(Date.parse(release.publishedAt))}
								style={{color: GUI_THEME.faint, fontSize: 11}}
							>
								{timeAgo(Date.parse(release.publishedAt))}
							</span>
						)}
					</div>

					{release.sections.map((section, k) => (
						<div key={k} style={{marginTop: 6}}>
							{section.title && (
								<div
									style={{
										color: GUI_THEME.dim,
										fontSize: 11,
										textTransform: 'uppercase',
										letterSpacing: 0.6,
										marginBottom: 3,
									}}
								>
									{section.title}
								</div>
							)}
							<ul
								style={{
									margin: 0,
									paddingLeft: 14,
									color: GUI_THEME.primarySoft,
									fontSize: 13,
									lineHeight: 1.55,
								}}
							>
								{section.items.map((item, j) => (
									<li key={j}>{item}</li>
								))}
							</ul>
						</div>
					))}
				</section>
			))}
		</div>

		<UpdateCommand commands={update.commands} />
	</div>
);

const INSTALLERS = [
	{key: 'script', label: 'curl'},
	{key: 'npm', label: 'npm'},
] as const;

// The install script, with npm one tab over.
const UpdateCommand = ({commands}: {commands: UpdateInfo['commands']}) => {
	const [installer, setInstaller] =
		useState<keyof UpdateInfo['commands']>('script');
	const command = commands[installer];

	return (
		<div
			style={{
				borderTop: `1px solid ${GUI_THEME.line}`,
				padding: '8px 10px 10px 16px',
			}}
		>
			<div
				role="tablist"
				aria-label="Install with"
				style={{display: 'flex', gap: 2, marginLeft: -6}}
			>
				{INSTALLERS.map(({key, label}) => (
					<button
						key={key}
						role="tab"
						data-testid={`version-tab-${label}`}
						aria-selected={installer === key}
						onClick={() => setInstaller(key)}
						style={{...segmentedButtonStyle(installer === key), fontSize: 11}}
					>
						{label}
					</button>
				))}
			</div>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: 8,
					marginTop: 6,
				}}
			>
				<code
					data-testid="version-command"
					style={{
						flex: 1,
						minWidth: 0,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						whiteSpace: 'nowrap',
						fontFamily: MONO_FONT,
						fontSize: 12,
						color: GUI_THEME.primary,
					}}
					title={command}
				>
					{command}
				</code>
				<CopyButton
					value={command}
					title="Copy update command"
					testId="version-copy"
				/>
			</div>
		</div>
	);
};
