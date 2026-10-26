// The history player over a dimmed board: transport, position bar, and the
// caption of the event that just landed.

import {useEffect, useRef} from 'react';
import {formatDateTime} from '../../../lib/utils/date.utils.js';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {clamp, usePrefersReducedMotion} from '../lib/scrubber';
import {THEATRE_KEYFRAMES, TheatrePlan, TheatrePlayback} from '../lib/theatre';
import {IconButton, ICON_SIZE} from './IconButton';
import {IconClose, IconPause, IconPlay, IconReplay} from './IconPlayback';

// How far an arrow key moves the bar, as a share of the whole movie.
const SEEK_STEP = 0.02;
const BAR_HEIGHT = 2;
const KNOB_SIZE = 9;

// One outlined size for every control, the transport set apart by colour.
const TRANSPORT_SIZE = 24;

const transportButtonStyle = (primary: boolean): React.CSSProperties => ({
	background: 'transparent',
	border: `1px solid ${primary ? GUI_THEME.accent : GUI_THEME.line}`,
	color: primary ? GUI_THEME.accent : GUI_THEME.secondary,
	borderRadius: 3,
	width: TRANSPORT_SIZE,
	height: TRANSPORT_SIZE,
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	cursor: 'pointer',
	flexShrink: 0,
	padding: 0,
	transition: 'color 160ms ease, border-color 160ms ease',
});

export const TheatrePlayer = ({
	plan,
	playback,
	onExit,
}: {
	plan: TheatrePlan;
	playback: TheatrePlayback;
	onExit: () => void;
}) => {
	const animate = !usePrefersReducedMotion();
	const trackRef = useRef<HTMLDivElement | null>(null);
	const {
		progress,
		playing,
		done,
		speed,
		cursor,
		current,
		currentTime,
		totalCount,
		toggle,
		cycleSpeed,
		seekTo,
		beginSeek,
		endSeek,
	} = playback;

	// Refs, so the listener binds once; the board re-renders every movie frame.
	const onExitRef = useRef(onExit);
	onExitRef.current = onExit;
	const toggleRef = useRef(toggle);
	toggleRef.current = toggle;

	// Space plays, Escape exits. On the document, since nothing inside keeps focus.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const tag = target?.tagName ?? '';

			// A form field keeps every key: the player can be opened with one
			// focused.
			if (
				target &&
				(target.isContentEditable ||
					['INPUT', 'TEXTAREA', 'SELECT'].includes(tag))
			) {
				return;
			}

			// Before the button check: Escape exits even from a focused control.
			if (event.key === 'Escape') {
				event.preventDefault();
				onExitRef.current();
				return;
			}

			// Space presses a focused button.
			if (tag === 'BUTTON') return;

			if (event.key === ' ' || event.key === 'Spacebar') {
				event.preventDefault();
				toggleRef.current();
			}
		};

		document.addEventListener('keydown', onKeyDown);
		return () => document.removeEventListener('keydown', onKeyDown);
	}, []);

	const fractionFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();

		return clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
	};

	return (
		<>
			<style>{THEATRE_KEYFRAMES}</style>

			{/* Vignette over everything but the player; inert. */}
			<div
				data-testid="theatre-vignette"
				style={{
					position: 'fixed',
					inset: 0,
					pointerEvents: 'none',
					zIndex: 40,
					background:
						'radial-gradient(120% 90% at 50% 45%, rgba(6,7,10,0) 35%, rgba(6,7,10,0.72) 100%)',
					animation: animate ? 'epiqTheatreFade 320ms ease-out' : undefined,
				}}
			/>

			<div
				data-testid="theatre-player"
				role="group"
				aria-label="History player"
				// A square drawer edge to edge at the foot, on the board's 30px gutter.
				style={{
					position: 'fixed',
					left: 0,
					right: 0,
					bottom: 0,
					zIndex: 50,
					display: 'flex',
					flexDirection: 'column',
					gap: 9,
					padding: '11px 30px 13px',
					borderTop: `1px solid ${GUI_THEME.line}`,
					background: 'rgba(13, 16, 22, 0.94)',
					backdropFilter: 'blur(14px)',
					WebkitBackdropFilter: 'blur(14px)',
					animation: animate ? 'epiqTheatreRise 260ms ease-out' : undefined,
				}}
			>
				<div style={{display: 'flex', alignItems: 'center', gap: 14}}>
					<IconButton
						testId="theatre-toggle"
						title={done ? 'Play again' : playing ? 'Pause' : 'Play'}
						aria-label={done ? 'Play again' : playing ? 'Pause' : 'Play'}
						pressed={playing}
						onClick={toggle}
					>
						{done ? (
							<IconReplay size={ICON_SIZE} />
						) : playing ? (
							<IconPause size={ICON_SIZE} />
						) : (
							<IconPlay size={ICON_SIZE} />
						)}
					</IconButton>

					{/* The board's position while up; the scrubber stands down. */}
					<div
						data-testid="theatre-progress"
						role="slider"
						aria-label="Playback position"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(progress * 100)}
						tabIndex={0}
						ref={trackRef}
						onPointerDown={event => {
							event.currentTarget.setPointerCapture(event.pointerId);
							beginSeek();
							seekTo(fractionFromEvent(event));
						}}
						onPointerMove={event => {
							if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
								return;
							}

							seekTo(fractionFromEvent(event));
						}}
						onPointerUp={event => {
							event.currentTarget.releasePointerCapture(event.pointerId);
							endSeek();
						}}
						onPointerCancel={endSeek}
						onKeyDown={event => {
							const step =
								event.key === 'ArrowLeft'
									? -SEEK_STEP
									: event.key === 'ArrowRight'
									? SEEK_STEP
									: null;

							if (step === null) return;

							event.preventDefault();
							seekTo(progress + step);
						}}
						style={{
							position: 'relative',
							flex: 1,
							height: 18,
							display: 'flex',
							alignItems: 'center',
							cursor: 'pointer',
							touchAction: 'none',
						}}
					>
						<div
							style={{
								position: 'absolute',
								left: 0,
								right: 0,
								height: BAR_HEIGHT,
								borderRadius: 999,
								background: 'rgba(122, 157, 214, 0.22)',
							}}
						/>
						<div
							style={{
								position: 'absolute',
								left: 0,
								width: `${progress * 100}%`,
								height: BAR_HEIGHT,
								borderRadius: 999,
								background: `linear-gradient(90deg, #b3a5ff, ${GUI_THEME.accent})`,
							}}
						/>
						<div
							style={{
								position: 'absolute',
								left: `${progress * 100}%`,
								width: KNOB_SIZE,
								height: KNOB_SIZE,
								marginLeft: -KNOB_SIZE / 2,
								borderRadius: '50%',
								background: GUI_THEME.accent,
								boxShadow: '0 0 5px rgba(118, 212, 255, 0.35)',
							}}
						/>
					</div>

					<button
						type="button"
						data-testid="theatre-speed"
						onClick={cycleSpeed}
						title="Playback speed"
						style={{
							...transportButtonStyle(false),
							width: 34,
							fontFamily: 'inherit',
							fontSize: TEXT.label,
							color: GUI_THEME.accent,
						}}
					>
						{speed}×
					</button>

					<IconButton
						testId="theatre-exit"
						title="Close the player"
						aria-label="Close the history player"
						onClick={onExit}
					>
						<IconClose size={ICON_SIZE} />
					</IconButton>
				</div>

				<div
					style={{
						display: 'flex',
						alignItems: 'baseline',
						gap: 12,
						fontSize: TEXT.meta,
						// Holds the row's height across a caption that comes and goes, so
						// the panel never breathes as the movie runs.
						minHeight: 16,
					}}
				>
					<span
						data-testid="theatre-time"
						style={{
							color: GUI_THEME.accent,
							fontVariantNumeric: 'tabular-nums',
							flexShrink: 0,
						}}
					>
						{formatDateTime(new Date(currentTime))}
					</span>

					<span
						data-testid="theatre-count"
						style={{
							color: GUI_THEME.dim2,
							fontVariantNumeric: 'tabular-nums',
							flexShrink: 0,
						}}
					>
						{cursor + 1}/{totalCount} edits
					</span>

					{/* Keyed on the event, so each caption animates in afresh. */}
					<span
						key={current?.id ?? 'start'}
						data-testid="theatre-caption"
						style={{
							color: GUI_THEME.secondary,
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
							animation: animate
								? 'epiqTheatreCaption 220ms ease-out'
								: undefined,
						}}
					>
						{current
							? current.label
							: `Opening on the board before ${formatDateTime(
									new Date(plan.events[0]!.t),
							  )}`}
					</span>
				</div>
			</div>
		</>
	);
};
