import React from 'react';
import {BoardUI} from './components/Board.js';
import {Board} from './lib/types/board.model.js';

process.stdout.write('\x1B[2J\x1B[0f');
export default function App({board}: {board: Board}) {
	return <BoardUI board={board} />;
}
