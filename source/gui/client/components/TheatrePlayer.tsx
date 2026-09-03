// The movie player that comes up over a dimmed board while its history plays:
// a transport, the bar that is the only control on the board's position while
// it is up, and the moment and caption of the event that just landed.

import {useEffect, useRef} from 'react';
import {formatDateTime} from '../../../lib/utils/date.utils.js';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {clamp, usePrefersReducedMotion} from '../lib/scrubber';
import {THEATRE_KEYFRAMES, TheatrePlan, TheatrePlayback} from '../lib/theatre';
import {
	IconClose,
	IconPause,
	IconPlay,
	IconPopOut,
	IconReplay,
} from './IconPlayback';

// How far an arrow key moves the bar, as a share of the whole movie.
const SEEK_STEP = 0.02;
const BAR_HEIGHT = 2;
const KNOB_SIZE = 9;

// Square and outlined at one size, the transport included: a filled accent
// disc is a media widget, and this sits in a terminal. The transport is set
// apart by colour alone, which is all it needs to be the one to reach for.
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
	logOpen,
	onToggleLog,
	onExit,
}: {
	plan: TheatrePlan;
	playback: TheatrePlayback;
	// Owned above: the log is a panel in the board's own row, so the layout has
	// to know about it, not just the drawer that opens it.
	logOpen: boolean;
	onToggleLog: () => void;
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

	// Held in refs so the listener below is bound once for the life of the
	// player. Both are re-created on every render of the board above, and the
	// board renders on every frame of the movie — listing them would add and
	// drop a document listener sixty times a second.
	const onExitRef = useRef(onExit);
	onExitRef.current = onExit;
	const toggleRef = useRef(toggle);
	toggleRef.current = toggle;

	// Space is the transport and Escape is the way out, for as long as the
	// player is up. Bound on the document rather than the panel: nothing inside
	// it holds focus after a click on the board behind.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;

			// Anything that answers a key itself keeps it. Form fields because the
			// player can be opened with one focused, and buttons because Space is
			// how a focused one is pressed — swallowing it here would leave the
			// player's own controls unreachable from the keyboard.
			if (
				target &&
				(target.isContentEditable ||
					['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))
			) {
				return;
			}

			if (event.key === 'Escape') {
				event.preventDefault();
				onExitRef.current();
				return;
			}

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

			{/* Darkens the edges so the board reads as the lit thing on the screen.
			    Over everything but the player itself, and never in the way of a
			    pointer — what it covers is already standing down. */}
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
				// A drawer risen from the foot of the window rather than a card
				// floating over it: attached edge to edge, square, and held apart
				// from the board by one hairline the way a dev tool's panel is. The
				// board's own 30px gutter carries through, so the transport lines up
				// with the first column.
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
					<button
						type="button"
						data-testid="theatre-toggle"
						onClick={toggle}
						title={done ? 'Play again' : playing ? 'Pause' : 'Play'}
						aria-label={done ? 'Play again' : playing ? 'Pause' : 'Play'}
						style={transportButtonStyle(true)}
					>
						{done ? (
							<IconReplay size={13} />
						) : playing ? (
							<IconPause size={13} />
						) : (
							<IconPlay size={13} />
						)}
					</button>

					{/* The board's position while the player is up. The scrubber stands
					    down for exactly this reason: two controls for one position
					    would fight over it. */}
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

					<button
						type="button"
						data-testid="theatre-exit"
						onClick={onExit}
						title="Leave the player and follow the board again"
						aria-label="Close the history player"
						style={transportButtonStyle(false)}
					>
						<IconClose size={12} />
					</button>
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

					{/* Keyed on the event so each caption is its own element, and the
					    entrance runs again for the next one rather than the text
					    swapping underneath a finished animation. */}
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

					{/* Beside the line it expands: the caption is the last of the log,
					    and this is the rest of it. */}
					<button
						type="button"
						data-testid="theatre-log-toggle"
						aria-pressed={logOpen}
						onClick={onToggleLog}
						title={
							logOpen
								? 'Hide the log'
								: 'Show every event as it plays, over the board'
						}
						aria-label="Show the log over the board"
						style={{
							background: 'transparent',
							border: 'none',
							padding: 0,
							marginLeft: 'auto',
							color: logOpen ? GUI_THEME.accent : GUI_THEME.dim,
							cursor: 'pointer',
							display: 'inline-flex',
							alignItems: 'center',
							flexShrink: 0,
							transition: 'color 160ms ease',
						}}
					>
						<IconPopOut size={12} />
					</button>
				</div>
			</div>
		</>
	);
};
