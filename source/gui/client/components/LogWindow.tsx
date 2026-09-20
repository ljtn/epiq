// The log's own window: the panel and nothing else, filling the window it was
// popped into. Fed by the board that opened it — see lib/log-window — so it
// has no socket, no board and no bar of its own; a click on a line is handed
// back to the board, which is where the ticket or the diff opens.

import {useEffect} from 'react';
import {GUI_THEME, TEXT, UI_FONT} from '../lib/gui-theme';
import {useLogMirror} from '../lib/log-window';
import {EventLog} from './EventLog';
import {GlobalScrollbarStyles} from './GlobalScrollbarStyles';

export const LogWindow = () => {
	const {lines, board, open, reportPinned} = useLogMirror();

	useEffect(() => {
		document.title = 'epiq — event log';
	}, []);

	return (
		<div
			style={{
				height: '100vh',
				// The same ground the docked log takes: one log, in two places.
				background: GUI_THEME.chrome,
				color: GUI_THEME.primary,
				fontFamily: UI_FONT,
				display: 'flex',
			}}
		>
			<GlobalScrollbarStyles />

			{board ? (
				<EventLog
					layout="window"
					entries={lines?.entries ?? []}
					moment={lines?.moment ?? Infinity}
					bottomClearance={0}
					onOpen={open}
					// Following is decided on the board's side for both panels: this
					// one is told which row it is standing on, and tells the board
					// whether it is at its foot.
					followedLine={lines?.followedLine ?? null}
					eventsUnlisted={lines?.eventsUnlisted ?? false}
					onPinnedChange={reportPinned}
					onDock={() => window.close()}
				/>
			) : (
				// Reached by its address rather than from a board: there is nothing
				// to mirror.
				<p
					data-testid="log-window-orphan"
					style={{
						margin: 'auto',
						color: GUI_THEME.dim,
						fontSize: TEXT.meta,
					}}
				>
					Open the log from a board to see it here.
				</p>
			)}
		</div>
	);
};
