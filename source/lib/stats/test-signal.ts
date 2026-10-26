// Whether the ticket wrote tests, and what it did to existing ones: deleted,
// skipped or focused counts matter more than the ratio.

import {
	isFocusedTestLine,
	isGeneratedPath,
	isSkippedTestLine,
	isTestPath,
} from './file-kinds.js';
import {filePointer} from './file-pointer.js';
import {FilePointer, TestSignal} from './issue-stats.model.js';
import {TicketPatch} from './patch-scan.js';

export const deriveTestSignal = ({patch}: {patch: TicketPatch}): TestSignal => {
	let testLinesAdded = 0;
	let testLinesRemoved = 0;
	const addedTestFiles: FilePointer[] = [];
	const deletedTestFiles: FilePointer[] = [];
	let skippedTestLinesAdded = 0;
	let focusedTestLinesAdded = 0;

	for (const file of patch.files) {
		if (file.binary || isGeneratedPath(file.path)) continue;

		if (!isTestPath(file.path)) continue;

		testLinesAdded += file.addedCount;
		testLinesRemoved += file.removed;
		if (file.status === 'added') addedTestFiles.push(filePointer(file));
		if (file.status === 'deleted') deletedTestFiles.push(filePointer(file));

		for (const {text} of file.added) {
			if (isSkippedTestLine(text)) skippedTestLinesAdded++;
			if (isFocusedTestLine(text)) focusedTestLinesAdded++;
		}
	}

	return {
		testLinesAdded,
		testLinesRemoved,
		addedTestFiles,
		deletedTestFiles,
		skippedTestLinesAdded,
		focusedTestLinesAdded,
	};
};
