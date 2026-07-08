import {createRoot} from 'react-dom/client';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import {App} from './App';

createRoot(document.getElementById('root')!).render(
	<BrowserRouter>
		<Routes>
			<Route path="/" element={<App />} />
			<Route path="/board/:boardId" element={<App />} />
			<Route path="/board/:boardId/issue/:issueId" element={<App />} />
			{/* Legacy form without the /issue/ segment, so old links keep working. */}
			<Route path="/board/:boardId/:issueId" element={<App />} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	</BrowserRouter>,
);
