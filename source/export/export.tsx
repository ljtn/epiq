import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import {BoardUI} from '../lib/components/BoardUI.js';
import {isSwimlaneNode} from '../lib/model/context.model.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getState} from '../lib/state/state.js';
import {render as renderInk} from 'ink';
import {Writable} from 'node:stream';
import {
	getExportsDirPath,
	resolveClosestEpiqRoot,
} from '../lib/storage/paths.js';

const pad = (n: number) => String(n).padStart(2, '0');

export const getFilenameSafeDateStamp = (date: Date): string => {
	const yyyy = date.getUTCFullYear();
	const mm = pad(date.getUTCMonth() + 1);
	const dd = pad(date.getUTCDate());
	const hh = pad(date.getUTCHours());
	const min = pad(date.getUTCMinutes());
	const ss = pad(date.getUTCSeconds());

	return `${yyyy}-${mm}-${dd}_${hh}-${min}-${ss}`;
};

const toFilenameSafeSegment = (value: string): string =>
	value
		.trim()
		.replace(/\s+/g, '-')
		.replace(/[^A-Za-z0-9._-]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^[-.]+|[-.]+$/g, '')
		.toLowerCase() || 'board';

const renderBoardToString = async (
	element: React.ReactElement,
	{width, height}: {width: number; height: number},
): Promise<string> => {
	let output = '';

	const stdout = new Writable({
		write(chunk, _encoding, callback) {
			const next = stripAnsi(chunk.toString()).trimEnd();

			if (next.trim().length > 0 && next.includes('╭')) {
				output = next;
			}

			callback();
		},
	}) as NodeJS.WriteStream;

	stdout.columns = width;
	stdout.rows = height;
	stdout.isTTY = true;

	const instance = renderInk(element, {
		stdout,
		debug: false,
		exitOnCtrlC: false,
		patchConsole: false,
		incrementalRendering: false,
	});

	await new Promise(resolve => setTimeout(resolve, 0));

	instance.unmount();

	return output;
};

const stripAnsi = (value: string): string =>
	value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

export const exportBoardLayout = async (): Promise<Result<string>> => {
	const {
		currentNode,
		selectedIndex,
		breadCrumb,
		viewMode,
		mode,
		renderedChildrenIndex,
	} = getState();

	const board = breadCrumb.find(node => node.context === 'BOARD');

	if (!board) {
		return failed('No board found to export');
	}

	const width = 120;
	const height = 40;

	const output = await renderBoardToString(
		<BoardUI
			height={height}
			width={width}
			swimlanes={(renderedChildrenIndex[board.id] ?? []).filter(
				node => node !== undefined && isSwimlaneNode(node),
			)}
			currentNode={currentNode}
			selectedIndex={selectedIndex}
			breadCrumb={breadCrumb}
			viewMode={viewMode}
			mode={mode}
		/>,
		{width, height},
	);

	if (!output) {
		return failed('Failed to render board export');
	}

	const epiqRootResult = resolveClosestEpiqRoot(process.cwd());
	if (isFail(epiqRootResult)) {
		return failed('Unable to export, epiq root not found');
	}

	const now = new Date();
	const date = getFilenameSafeDateStamp(now);
	const exportFileName = `board_${toFilenameSafeSegment(
		board.title,
	)}_${date}.md`;
	const exportsDir = getExportsDirPath(epiqRootResult.value);
	fs.mkdirSync(exportsDir, {recursive: true});
	const exportPath = path.join(exportsDir, exportFileName);

	const markdown = `# Board - ${board.title}
Date: ${now.toISOString()}

\`\`\`text
${output}
\`\`\`
`;

	fs.writeFileSync(exportPath, markdown, 'utf8');

	return succeeded('Exported board layout', exportPath);
};
