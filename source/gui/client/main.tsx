import {createRoot} from 'react-dom/client';
import {WorkerPoolContextProvider} from '@pierre/diffs/react';
import {createBrowserRouter, Navigate, RouterProvider} from 'react-router-dom';
import {App} from './App';
import {LogWindow} from './components/LogWindow';
import {DiffWrapProvider} from './lib/diff-wrap';
import {LOG_WINDOW_PATH} from './lib/log-window';
import {
	DIFF_WORKER_HIGHLIGHTER_OPTIONS,
	DIFF_WORKER_POOL_OPTIONS,
} from './lib/diffs-worker-pool';

// The board inside the diff worker pool (lib/diffs-worker-pool). Not around the
// router: the popped-out log draws no diffs and would start workers for nothing.
const board = (
	<WorkerPoolContextProvider
		poolOptions={DIFF_WORKER_POOL_OPTIONS}
		highlighterOptions={DIFF_WORKER_HIGHLIGHTER_OPTIONS}
	>
		<DiffWrapProvider>
			<App />
		</DiffWrapProvider>
	</WorkerPoolContextProvider>
);

// A data router, which is what lets the board hold a navigation back to ask
// about unsent text (`useBlocker`).
const router = createBrowserRouter([
	// The event log popped out of a board — see lib/log-window.
	{path: LOG_WINDOW_PATH, element: <LogWindow />},
	// One element for every board path, so selecting a ticket never remounts the board.
	{path: '/', element: board},
	{path: '/board/:boardId/*', element: board},
	{path: '*', element: <Navigate to="/" replace />},
]);

createRoot(document.getElementById('root')!).render(
	<RouterProvider router={router} />,
);
