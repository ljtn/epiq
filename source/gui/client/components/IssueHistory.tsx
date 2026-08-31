import {GuiIssueHistoryEntry} from '../lib/gui-state.model';
import {GUI_THEME, CONTENT_FONT, TEXT} from '../lib/gui-theme';
import {formatAbsolute, timeAgo} from '../lib/gui-format.helper';
import {Button} from './Button';
import {IconClock} from './IconClock';
import {User} from './User';

export const IssueHistory = ({
	entries,
	onHoverEvent,
	onCheckoutEvent,
}: {
	entries: GuiIssueHistoryEntry[];
	onHoverEvent: (eventId: string | null) => void;
	// Absent with the socket down: nothing can be checked out from a page that
	// cannot ask the server for it.
	onCheckoutEvent?: (eventId: string) => void;
}) => {
	if (entries.length === 0) {
		return (
			<div style={{color: GUI_THEME.dim, fontSize: TEXT.ui}}>
				No history yet
			</div>
		);
	}

	// Newest first
	const ordered = [...entries].reverse();

	return (
		<div
			data-testid="issue-history"
			onMouseLeave={() => onHoverEvent(null)}
			style={{display: 'flex', flexDirection: 'column'}}
		>
			{ordered.map((entry, index) => (
				<div
					key={entry.id}
					data-testid="issue-history-row"
					onMouseEnter={() => onHoverEvent(entry.id)}
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 14,
						padding: '8px 0',
						borderTop: index === 0 ? 'none' : `1px solid ${GUI_THEME.line}`,
						fontSize: TEXT.ui,
					}}
				>
					<User user={entry.actor} />

					<span
						style={{
							flex: 1,
							color: GUI_THEME.primary,
							fontFamily: CONTENT_FONT,
						}}
					>
						{entry.label}
					</span>

					<span
						title={formatAbsolute(entry.t)}
						style={{color: GUI_THEME.dim, whiteSpace: 'nowrap'}}
					>
						{timeAgo(entry.t)}
					</span>

					{onCheckoutEvent && (
						<Button
							variant="ghost"
							data-testid="issue-history-checkout"
							aria-label={`Check out the board as it was after: ${entry.label}`}
							title="Check out the board as it was just after this event"
							onClick={() => onCheckoutEvent(entry.id)}
							style={{
								display: 'flex',
								alignItems: 'center',
								color: GUI_THEME.dim,
							}}
						>
							<IconClock size={13} />
						</Button>
					)}
				</div>
			))}
		</div>
	);
};
