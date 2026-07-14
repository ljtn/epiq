import fs from 'node:fs';
import path from 'node:path';
import {getStateBranchRoot} from '../../git/git-storage.js';
import {getAttachmentFileName} from '../media/media-store.js';
import {AttachmentState} from '../model/app-state.model.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {
	getMediaDirPath,
	resolveClosestEpiqProjectRoot,
} from '../storage/paths.js';
import {openUrl} from './open-in-browser.js';

/**
 * Opens an attachment's local blob with the system opener. The blob lives
 * in the state branch worktree, so no server needs to be running.
 */
export const openAttachment = (attachment: AttachmentState): Result => {
	const repoRootResult = resolveClosestEpiqProjectRoot(process.cwd());
	if (isFail(repoRootResult)) return failed('Unable to resolve project root');

	const stateRootResult = getStateBranchRoot({
		repoRoot: repoRootResult.value,
	});
	if (isFail(stateRootResult)) return failed(stateRootResult.message);

	const fileName = getAttachmentFileName(attachment.hash, attachment.ext);
	const blobPath = path.join(getMediaDirPath(stateRootResult.value), fileName);

	if (!fs.existsSync(blobPath)) {
		return failed('Attachment file not found — run :sync to fetch it');
	}

	openUrl(blobPath);

	return succeeded(`Opened ${attachment.name}`, null);
};
