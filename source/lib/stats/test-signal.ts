// Whether the ticket wrote any tests, and what it did to the ones already
// there.
//
// The ratio is the least interesting number here and the easiest to game. The
// three counts under it are the ones worth a reader's eye: a ticket that
// deleted tests, or added a skipped one, or added a focused one, has done
// something that needs a sentence of explanation somewhere.

import {
	isFocusedTestLine,
	isGeneratedPath,
	isSkippedTestLine,
	isTestPath,
} from './file-kinds.js';
import {TestSignal} from './issue-stats.model.js';
import {TicketPatch} from './patch-scan.js';

export const deriveTestSignal = ({patch}: {patch: TicketPatch}): TestSignal => {
	let testLinesAdded = 0;
	let testLinesRemoved = 0;
	let codeLinesAdded = 0;
	let testFilesAdded = 0;
	let testFilesDeleted = 0;
	let skippedTestLinesAdded = 0;
	let focusedTestLinesAdded = 0;
	let touchedTests = false;

	for (const file of patch.files) {
		if (file.binary || isGeneratedPath(file.path)) continue;

		if (!isTestPath(file.path)) {
			codeLinesAdded += file.addedCount;
			continue;
		}

		touchedTests = true;
		testLinesAdded += file.addedCount;
		testLinesRemoved += file.removed;
		if (file.status === 'added') testFilesAdded++;
		if (file.status === 'deleted') testFilesDeleted++;

		for (const {text} of file.added) {
			if (isSkippedTestLine(text)) skippedTestLinesAdded++;
			if (isFocusedTestLine(text)) focusedTestLinesAdded++;
		}
	}

	return {
		testLinesAdded,
		testLinesRemoved,
		codeLinesAdded,
		ratio: codeLinesAdded === 0 ? null : testLinesAdded / codeLinesAdded,
		touchedTests,
		testFilesAdded,
		testFilesDeleted,
		skippedTestLinesAdded,
		focusedTestLinesAdded,
	};
};
