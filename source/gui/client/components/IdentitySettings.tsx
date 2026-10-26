import {useEffect, useState} from 'react';
import {
	MAX_AUTO_SYNC_INTERVAL_MS,
	MIN_AUTO_SYNC_INTERVAL_MS,
} from '../../../lib/config/auto-sync-interval.js';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {META, ROW} from '../lib/card.style';
import {SyncSettingsState} from '../lib/use-sync-settings';
import {Input} from './FormPrimitives';
import {Switch} from './Switch';

// Autosync: the switch and its interval. Seconds here, milliseconds on the wire.

const MIN_SECONDS = MIN_AUTO_SYNC_INTERVAL_MS / 1000;
// A day: past `setTimeout`'s ceiling a long interval turns into 1ms.
const MAX_SECONDS = MAX_AUTO_SYNC_INTERVAL_MS / 1000;

const secondsOf = (intervalMs: number) => String(Math.round(intervalMs / 1000));

export const IdentitySettings = ({
	state,
	onChange,
}: {
	state: SyncSettingsState;
	onChange: (patch: {autoSync?: boolean; autoSyncIntervalMs?: number}) => void;
}) => {
	const settings = state.data;

	// The box's text, committed on Enter or blur so a half-typed value is never sent.
	const [draft, setDraft] = useState('');

	// On every answer, so a refused write falls back to the configured value.
	useEffect(() => {
		if (settings) setDraft(secondsOf(settings.intervalMs));
	}, [settings?.intervalMs, state.answeredAt]);

	if (!settings) {
		return (
			<div style={{...META, paddingTop: 12}}>
				{state.lastError ?? 'Reading…'}
			</div>
		);
	}

	const seconds = Number(draft);

	// The configured value is never flagged, even below the floor: the bounds
	// govern only what may be asked for, and tests store tiny intervals.
	const pristine = draft === secondsOf(settings.intervalMs);

	const outOfRange =
		!pristine &&
		draft.trim() !== '' &&
		(!Number.isFinite(seconds) ||
			seconds < MIN_SECONDS ||
			seconds > MAX_SECONDS);

	const commit = () => {
		// Nothing typed, so nothing to send — and nothing to correct either,
		// even where what is configured is out of bounds.
		if (pristine) return;

		if (outOfRange || draft.trim() === '') {
			setDraft(secondsOf(settings.intervalMs));
			return;
		}

		const intervalMs = Math.round(seconds) * 1000;

		// Same interval after rounding: reset the box to the configured value.
		if (intervalMs === settings.intervalMs) {
			setDraft(secondsOf(settings.intervalMs));
			return;
		}

		onChange({autoSyncIntervalMs: intervalMs});
	};

	// Three states, and only ever one of them: a bound being broken, the
	// refusal that came back, and the setting that is on but cannot run.
	const note = outOfRange
		? seconds > MAX_SECONDS
			? `${MAX_SECONDS} seconds — a day — is the longest interval.`
			: `${MIN_SECONDS} seconds is the shortest interval.`
		: state.lastError
		? state.lastError
		: settings.enabled && settings.blockedReason
		? // A toggle that reports success and then does nothing is worse than
		  // one that is refused: the loops want a name and an editor before
		  // they run, and nothing else would ever say so.
		  `Not running — ${settings.blockedReason}.`
		: null;

	return (
		<div data-testid="identity-autosync">
			<div style={{...ROW, padding: '14px 0 12px'}}>
				<div style={{minWidth: 0}}>
					<div>Sync on its own</div>
					<div style={META}>
						Pulls and pushes this machine&rsquo;s changes while the board is
						open.
					</div>
				</div>
				<Switch
					testId="autosync-toggle"
					label={settings.enabled ? 'On' : 'Off'}
					checked={settings.enabled}
					onChange={next => onChange({autoSync: next})}
				/>
			</div>

			<div style={{...ROW, borderBottom: 'none'}}>
				<div>Every</div>
				<label
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						color: GUI_THEME.dim,
						fontSize: TEXT.ui,
					}}
				>
					<Input
						data-testid="autosync-interval"
						type="number"
						min={MIN_SECONDS}
						max={MAX_SECONDS}
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
							width: 56,
							borderRadius: 6,
							padding: '4px 8px',
							fontSize: TEXT.prose,
							textAlign: 'right',
							...(outOfRange
								? // Whole: Input sets the shorthand, and a longhand over it
								  // warns as it comes and goes.
								  {color: GUI_THEME.red, border: `1px solid ${GUI_THEME.red}`}
								: {}),
						}}
					/>
					seconds
				</label>
			</div>

			{note && <div style={{...META, color: GUI_THEME.red}}>{note}</div>}
		</div>
	);
};
