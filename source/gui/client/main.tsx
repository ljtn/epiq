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

createRoot(document.getElementById('root')!).render(
	// Outside the router, so the pool outlives every route that draws a diff
	// rather than being torn down and restarted with one — see lib/diffs-worker-pool.
	<WorkerPoolContextProvider
		poolOptions={DIFF_WORKER_POOL_OPTIONS}
		highlighterOptions={DIFF_WORKER_HIGHLIGHTER_OPTIONS}
	>
		<BrowserRouter>
			<Routes>
				{/* The event log popped out of a board — see lib/log-window. */}
				<Route path={LOG_WINDOW_PATH} element={<LogWindow />} />
				{/* One element for every board path, including the ticket ones. A route
				    per shape would swap elements on selecting a ticket, remounting the
				    board and replaying the timeline's entrance. */}
				<Route path="/" element={<App />} />
				<Route path="/board/:boardId/*" element={<App />} />
				<Route path="*" element={<Navigate to="/" replace />} />
			</Routes>
		</BrowserRouter>
	</WorkerPoolContextProvider>,
);
