import {createRoot} from 'react-dom/client';
import {WorkerPoolContextProvider} from '@pierre/diffs/react';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {App} from './App';
import {LogWindow} from './components/LogWindow';
import {LOG_WINDOW_PATH} from './lib/log-window';
import {
	DIFF_WORKER_HIGHLIGHTER_OPTIONS,
	DIFF_WORKER_POOL_OPTIONS,
} from './lib/diffs-worker-pool';

// The board, with somewhere for the diff highlighter to run — see
// lib/diffs-worker-pool. One element for both board routes, so moving between
// them does not tear the pool down and start it again.
//
// Around the board rather than around the router: the popped-out log window
// draws no diffs, and the provider starts its workers as it mounts, so giving
// it one would spend a window's worth of them on nothing.
const board = (
	<WorkerPoolContextProvider
		poolOptions={DIFF_WORKER_POOL_OPTIONS}
		highlighterOptions={DIFF_WORKER_HIGHLIGHTER_OPTIONS}
	>
		<App />
	</WorkerPoolContextProvider>
);

createRoot(document.getElementById('root')!).render(
	<BrowserRouter>
		<Routes>
			{/* The event log popped out of a board — see lib/log-window. */}
			<Route path={LOG_WINDOW_PATH} element={<LogWindow />} />
			{/* One element for every board path, including the ticket ones. A route
			    per shape would swap elements on selecting a ticket, remounting the
			    board and replaying the timeline's entrance. */}
			<Route path="/" element={board} />
			<Route path="/board/:boardId/*" element={board} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	</BrowserRouter>,
);
