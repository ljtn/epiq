import {useEffect, useState} from 'react';
import {MIN_AUTO_SYNC_INTERVAL_MS} from '../../../lib/config/auto-sync-interval.js';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {CARD, META, SECTION_HEADING} from '../lib/identity-panel.style';
import {SyncSettingsState} from '../lib/use-sync-settings';
import {Checkbox} from './Checkbox';

// The two settings that were the TUI's alone: whether the board syncs itself,
// and how often. They belong beside the addresses rather than in a settings
// screen of their own — both are answers to "what is this machine doing on my
// behalf", which is the question the panel already opens on.
//
// Seconds here, milliseconds on the wire. Nobody thinks about a sync in
// milliseconds, and the three zeroes were the whole reason the TUI's own
// prompt has to carry an examples list.

const MIN_SECONDS = MIN_AUTO_SYNC_INTERVAL_MS / 1000;

const secondsOf = (intervalMs: number) => String(Math.round(intervalMs / 1000));

export const IdentitySettings = ({
	state,
	onChange,
}: {
	state: SyncSettingsState;
	onChange: (patch: {autoSync?: boolean; autoSyncIntervalMs?: number}) => void;
}) => {
	const settings = state.data;

	// What is in the box while it is being typed in, which is not yet a
	// setting. Committed on Enter or on leaving the field, so a half-typed "1"
	// on the way to "15" is never sent and never refused.
	const [draft, setDraft] = useState('');

	useEffect(() => {
		if (settings) setDraft(secondsOf(settings.intervalMs));
	}, [settings?.intervalMs]);

	if (!settings) {
		return (
			<>
				<div style={SECTION_HEADING}>Auto sync</div>
				<div style={{...META, marginTop: 0}}>
					{state.lastError ?? 'Reading…'}
				</div>
			</>
		);
	}

	const seconds = Number(draft);
	const tooShort =
		draft.trim() !== '' && (!Number.isFinite(seconds) || seconds < MIN_SECONDS);

	const commit = () => {
		if (tooShort || draft.trim() === '') {
			setDraft(secondsOf(settings.intervalMs));
			return;
		}

		const intervalMs = Math.round(seconds) * 1000;
		if (intervalMs === settings.intervalMs) return;

		onChange({autoSyncIntervalMs: intervalMs});
	};

	return (
		<>
			<div style={SECTION_HEADING}>Auto sync</div>
			<div
				data-testid="identity-autosync"
				style={{
					...CARD,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: 12,
				}}
			>
				<Checkbox
					testId="autosync-toggle"
					label={settings.enabled ? 'on' : 'off'}
					checked={settings.enabled}
					onChange={next => onChange({autoSync: next})}
				/>

				<label
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						color: GUI_THEME.dim,
						fontSize: TEXT.meta,
					}}
				>
					every
					<input
						data-testid="autosync-interval"
						type="number"
						min={MIN_SECONDS}
						step={1}
						value={draft}
						onChange={event => setDraft(event.target.value)}
						onBlur={commit}
						onKeyDown={event => {
							if (event.key === 'Enter') event.currentTarget.blur();
							// The panel closes on Escape, and a field mid-edit should
							// abandon the edit rather than the panel.
							if (event.key === 'Escape') {
								event.stopPropagation();
								setDraft(secondsOf(settings.intervalMs));
							}
						}}
						style={{
							width: 52,
							background: GUI_THEME.bg,
							color: tooShort ? GUI_THEME.red : GUI_THEME.primary,
							border: `1px solid ${tooShort ? GUI_THEME.red : GUI_THEME.line}`,
							borderRadius: 4,
							padding: '3px 6px',
							font: 'inherit',
							fontSize: TEXT.meta,
							outline: 'none',
							textAlign: 'right',
						}}
					/>
					s
				</label>
			</div>

			{/* Three states, and only ever one of them: the floor while it is
			    being broken, the refusal that came back, and the setting that is
			    on but cannot run. */}
			{tooShort ? (
				<div style={{...META, color: GUI_THEME.red}}>
					{MIN_SECONDS} seconds is the shortest interval.
				</div>
			) : state.lastError ? (
				<div style={{...META, color: GUI_THEME.red}}>{state.lastError}</div>
			) : (
				settings.enabled &&
				settings.blockedReason && (
					// A toggle that reports success and then does nothing is worse
					// than one that is refused: the loops want a name and an editor
					// before they run, and nothing else would ever say so.
					<div style={{...META, color: GUI_THEME.red}}>
						Not running — {settings.blockedReason}.
					</div>
				)
			)}
		</>
	);
};
