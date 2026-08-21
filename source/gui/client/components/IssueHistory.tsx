import {GuiIssueHistoryEntry} from '../lib/gui-state.model';
import {GUI_THEME, CONTENT_FONT} from '../lib/gui-theme';
import {formatAbsolute, timeAgo} from '../lib/gui-format.helper';
import {User} from './User';

export const IssueHistory = ({
	entries,
	onHoverEvent,
}: {
	entries: GuiIssueHistoryEntry[];
	onHoverEvent: (eventId: string | null) => void;
}) => {
	if (entries.length === 0) {
		return (
			<div style={{color: GUI_THEME.dim, fontSize: 12}}>No history yet</div>
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
						alignItems: 'baseline',
						gap: 14,
						padding: '8px 0',
						borderTop: index === 0 ? 'none' : `1px solid ${GUI_THEME.line}`,
						fontSize: 12,
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
				</div>
			))}
		</div>
	);
};
