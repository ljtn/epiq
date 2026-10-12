import {GUI_THEME} from '../lib/gui-theme';
import {formatAbsolute, timeAgo} from '../lib/gui-format.helper';
import {META, SECTION_HEADING} from '../lib/identity-panel.style';
import {PersonalStatsState} from '../lib/use-personal-stats';
import {Stat} from './StatRow';

// What the person reading this has actually done here: the Stats tab's own
// figure, four of them at the panel's size.

export const IdentityStats = ({state}: {state: PersonalStatsState}) => {
	const stats = state.data;

	if (!stats) {
		return (
			<>
				<div style={SECTION_HEADING}>Your contributions</div>
				<div
					style={{
						...META,
						marginTop: 0,
						color: state.error ? GUI_THEME.red : GUI_THEME.dim,
					}}
				>
					{state.error ?? 'Counting…'}
				</div>
			</>
		);
	}

	return (
		<>
			<div style={SECTION_HEADING}>Your contributions</div>
			<div
				data-testid="identity-stats"
				style={{
					display: 'grid',
					gridTemplateColumns: '1fr 1fr',
					gap: 8,
				}}
			>
				{/* A history that could not be read has no commit count — which
				    is not the same as none, and must not be drawn as a zero. */}
				<Stat
					size="compact"
					testId="identity-stat-commits"
					label="commits"
					value={stats.scanned ? String(stats.commits) : '—'}
				/>
				<Stat
					size="compact"
					testId="identity-stat-tickets"
					label="tickets opened"
					value={String(stats.tickets)}
				/>
				<Stat
					size="compact"
					testId="identity-stat-comments"
					label="comments"
					value={String(stats.comments)}
				/>
				{/* Relative in the cell, exact on hover — the bargain every other
				    date in this GUI strikes. */}
				<Stat
					size="compact"
					testId="identity-stat-joined"
					label="joined"
					value={stats.joinedAt === null ? 'not yet' : timeAgo(stats.joinedAt)}
					title={
						stats.joinedAt === null ? undefined : formatAbsolute(stats.joinedAt)
					}
				/>
			</div>

			{/* The zero that is this panel's own subject. A bare 0 reads as "you
			    have written none"; the reason is that no address resolves to you,
			    and the fix is the section under this one.

			    Only where the scan actually ran. Said on a failed one it would
			    tell somebody holding several claims that they hold none, and
			    contradict the scan error the panel shows a few rows down. */}
			{stats.scanned && stats.claimedEmails === 0 && (
				<div style={{...META, marginTop: 8}}>
					No git address is yours yet, so no commit counts as one — claim one
					under Git addresses.
				</div>
			)}
		</>
	);
};
