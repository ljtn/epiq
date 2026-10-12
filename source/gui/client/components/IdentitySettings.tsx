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

// The two settings that were the TUI's alone: whether the board syncs itself,
// and how often. Two rows — the switch, then the interval it runs at — each a
// thing on the left and its control on the right.
//
// Seconds here, milliseconds on the wire. Nobody thinks about a sync in
// milliseconds, and the three zeroes were the whole reason the TUI's own
// prompt has to carry an examples list.

const MIN_SECONDS = MIN_AUTO_SYNC_INTERVAL_MS / 1000;
// A day. Past the ceiling `setTimeout` turns a very long interval into a 1ms
// one, and this field takes seconds where the TUI's takes milliseconds — so
// somebody carrying `3600000` over from `:config autosync-duration` is one
// paste away from asking for it.
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

	// What is in the box while it is being typed in, which is not yet a
	// setting. Committed on Enter or on leaving the field, so a half-typed "1"
	// on the way to "15" is never sent and never refused.
	const [draft, setDraft] = useState('');

	// On every answer from the server, not only on a changed value: a refused
	// write comes back with the setting unaltered, and the box must fall back
	// to what is configured rather than keep the number that was turned down.
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

	// What is configured is never wrong to show, whatever it is. The bounds
	// govern what somebody may *ask* for, and a stored value below the floor is
	// a state the loops deliberately preserve — the suites run at 1ms and
	// `follow-arrival.pw.ts` writes 1000 into this very file. Flagging it on
	// sight opened the panel with a red error against a number nobody typed,
	// and `commit` wrote the same number straight back, so it could not be
	// cleared without changing the setting.
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

		// Nothing to send, but the box may still not be showing the setting:
		// `37.4` against a configured 37s rounds to the same interval, and
		// without this it sits there as a number that is not what is
		// configured and never will be.
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
					label={settings.enabled ? 'on' : 'off'}
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
								? {color: GUI_THEME.red, borderColor: GUI_THEME.red}
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
