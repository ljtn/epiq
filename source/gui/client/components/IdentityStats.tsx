import {GUI_THEME} from '../lib/gui-theme';
import {formatAbsolute, timeAgo} from '../lib/gui-format.helper';
import {META, SECTION_HEADING} from '../lib/identity-panel.style';
import {PersonalStatsState} from '../lib/use-personal-stats';
import {StatRow} from './StatRow';

// What the person reading this has actually done here. A list rather than the
// Stats tab's grid of big figures: the panel's own type is 12px, and four
// numbers at 38 would be the loudest thing in a popover whose subject is
// somebody's identity, not their output.
//
// `StatRow` is that tab's own mark for a named figure in a list, so the two
// surfaces read as one system rather than as two takes on counting.

export const IdentityStats = ({state}: {state: PersonalStatsState}) => {
	const stats = state.data;

	if (!stats) {
		return (
			<>
				<div style={SECTION_HEADING}>Your work here</div>
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
			<div style={SECTION_HEADING}>Your work here</div>
			<div data-testid="identity-stats">
				<StatRow left="commits" right={String(stats.commits)} />
				<StatRow left="tickets opened" right={String(stats.tickets)} />
				<StatRow left="comments" right={String(stats.comments)} />
				<StatRow
					left="joined"
					right={
						stats.joinedAt === null ? (
							'not yet'
						) : (
							// Relative in the row, exact on hover — the bargain every
							// other date in this GUI strikes. Both inline read as one
							// long string and pushed the label out of a 440px panel.
							<span title={formatAbsolute(stats.joinedAt)}>
								{timeAgo(stats.joinedAt)}
							</span>
						)
					}
					last
				/>
			</div>

			{/* The zero that is this panel's own subject. A bare 0 reads as "you
			    have written none"; the reason is that no address resolves to you,
			    and the fix is the list immediately below. */}
			{stats.claimedEmails === 0 && (
				<div style={META}>
					No git address is yours yet, so no commit counts as one — claim one
					below.
				</div>
			)}
		</>
	);
};
