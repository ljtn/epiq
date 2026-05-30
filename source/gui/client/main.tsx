import React from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './App.js';

const root = document.getElementById('root');

if (!root) {
	throw new Error('Missing root element');
}

createRoot(root).render(<App />);
