import {useState} from 'react';

/**
 * Whether a commit opens with its files already unfolded.
 *
 * The reader's last "Expand all" or "Collapse all" is the answer: reading two
 * commits in a row is the common case, and having to ask for the same thing
 * again on the second one is the annoyance. It is per browser rather than per
 * board, like the panel's dock and width — a reading habit, not a property of
 * the work.
 */
const OPEN_FILES_STORAGE_KEY = 'epiq.commits.openFiles';

export const readStoredOpenFiles = (): boolean =>
	localStorage.getItem(OPEN_FILES_STORAGE_KEY) === 'true';

// Read in the initializer rather than an effect: the first commit opened after
// a reload should already know the answer, not unfold a frame later.
export const useOpenFilesByDefault = (): [boolean, (next: boolean) => void] => {
	const [openFiles, setOpenFiles] = useState(readStoredOpenFiles);

	return [
		openFiles,
		(next: boolean) => {
			setOpenFiles(next);
			localStorage.setItem(OPEN_FILES_STORAGE_KEY, String(next));
		},
	];
};
