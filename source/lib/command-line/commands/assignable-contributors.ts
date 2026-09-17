import {loadActorNames} from '../../board/board-log.js';
import {
	contributorDirectory,
	DirectoryEntry,
} from '../../repository/contributor-directory.js';
import {getState} from '../../state/state.js';

// The registry only holds people explicitly created or assigned, so it is often
// empty even of you; log authors are candidates too. The union itself is
// `contributorDirectory`, shared with the API surface so the TUI and the GUI
// offer the same people.
export const getAssignableContributors = (
	// The state branch root, for the names only a pre-ZFZFW9D log file name
	// carries. An event no longer holds one.
	stateBranchRoot: string,
): DirectoryEntry[] => {
	// May run before boot has populated the log.
	const {eventLog = [], contributors} = getState();

	return contributorDirectory({
		events: eventLog,
		registry: contributors,
		logFileNames: loadActorNames(stateBranchRoot),
	});
};
