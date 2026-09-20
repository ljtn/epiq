import fs from 'node:fs';
import path from 'node:path';
import {ulid} from 'ulid';
import {loadSettingsFromConfig} from '../../lib/config/user-config.js';
import {materializeAndPersistAll} from '../../lib/board/board-log.js';
import {actorOf, AppEvent} from '../../lib/board/board-events.model.js';
import {
	failed,
	isFail,
	Result,
	succeeded,
} from '../../lib/model/result-types.js';
import {sanitizeInlineText} from '../../lib/utils/string.utils.js';
import {findWritableIssue} from './node-targets.js';
import {
	DEFAULT_ATTACHMENT_MAX_KB,
	getAttachmentFileName,
	getAttachmentMarkdown,
	resolveAttachmentBlob,
	writeAttachmentBlob,
} from '../../lib/media/media-store.js';
import {ToolInput, bootLocal, bootedWithActorAndState} from './boot.js';

type AddIssueAttachmentInput = ToolInput & {
	issueId: string;
	name?: string;
	// Either the bytes inline, as the GUI's upload endpoint sends them, or a
	// path for a caller that already has the image on disk — an agent holding
	// a screenshot should not have to base64 it through its own context.
	dataBase64?: string;
	filePath?: string;
};

const readAttachmentBytes = (
	input: AddIssueAttachmentInput,
): Result<{data: Buffer; name: string}> => {
	if (input.filePath) {
		try {
			return succeeded('Read attachment file', {
				data: fs.readFileSync(input.filePath),
				name: input.name ?? path.basename(input.filePath),
			});
		} catch (error) {
			return failed(
				`Unable to read ${input.filePath}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	}

	if (!input.dataBase64) return failed('Provide either filePath or dataBase64');

	return succeeded('Decoded attachment data', {
		data: Buffer.from(input.dataBase64, 'base64'),
		name: input.name ?? 'image',
	});
};

type DeleteIssueAttachmentInput = ToolInput & {
	attachmentId: string;
};

type GetAttachmentBlobInput = ToolInput & {
	fileName: string;
};

export const getAttachmentMaxKb = (): number => {
	const settings = loadSettingsFromConfig();
	if (isFail(settings)) return DEFAULT_ATTACHMENT_MAX_KB;

	return settings.value.attachmentMaxKb ?? DEFAULT_ATTACHMENT_MAX_KB;
};

export const addIssueAttachment = async (input: AddIssueAttachmentInput) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const issueResult = findWritableIssue(input.issueId);
	if (isFail(issueResult)) return issueResult;

	const bytesResult = readAttachmentBytes(input);
	if (isFail(bytesResult)) return bytesResult;

	const written = writeAttachmentBlob(
		ready.value.boot.stateBranchRoot,
		bytesResult.value.data,
		getAttachmentMaxKb(),
	);
	if (isFail(written)) return written;

	const name = sanitizeInlineText(bytesResult.value.name).trim() || 'image';
	const attachmentId = ulid();

	const event = {
		id: ulid(),
		...actorOf(ready.value.actor),
		action: 'add.issue.attachment',
		payload: {
			id: attachmentId,
			issue: input.issueId,
			author: ready.value.actor.userId,
			hash: written.value.hash,
			ext: written.value.ext,
			name,
			bytes: written.value.bytes,
		},
	} satisfies AppEvent<'add.issue.attachment'>;

	const results = materializeAndPersistAll(
		[event],
		ready.value.boot.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	const fileName = getAttachmentFileName(written.value.hash, written.value.ext);

	return succeeded('Added issue attachment', {
		id: attachmentId,
		issueId: input.issueId,
		fileName,
		bytes: written.value.bytes,
		markdown: getAttachmentMarkdown(name, fileName),
	});
};

export const deleteIssueAttachment = async (
	input: DeleteIssueAttachmentInput,
) => {
	const ready = await bootedWithActorAndState(input.repoRoot);
	if (isFail(ready)) return ready;

	const attachmentEvent = ready.value.state.eventLog.find(
		(event): event is AppEvent<'add.issue.attachment'> =>
			event.action === 'add.issue.attachment' &&
			event.payload.id === input.attachmentId,
	);

	if (!attachmentEvent) {
		return failed('Unable to resolve attachment');
	}

	if (attachmentEvent.payload.author !== ready.value.actor.userId) {
		return failed('You can only delete your own attachments');
	}

	const issueResult = findWritableIssue(attachmentEvent.payload.issue);
	if (isFail(issueResult)) return issueResult;

	const alreadyDeleted = ready.value.state.eventLog.some(
		event =>
			event.action === 'delete.issue.attachment' &&
			event.payload.id === input.attachmentId,
	);

	if (alreadyDeleted) {
		return succeeded('Attachment already deleted', {
			id: input.attachmentId,
			issueId: attachmentEvent.payload.issue,
		});
	}

	const event = {
		id: ulid(),
		...actorOf(ready.value.actor),
		action: 'delete.issue.attachment',
		payload: {
			id: input.attachmentId,
			issue: attachmentEvent.payload.issue,
		},
	} satisfies AppEvent<'delete.issue.attachment'>;

	const results = materializeAndPersistAll(
		[event],
		ready.value.boot.stateBranchRoot,
	);

	if (isFail(results)) return failed(results.message);

	return succeeded('Deleted issue attachment', {
		id: input.attachmentId,
		issueId: attachmentEvent.payload.issue,
	});
};

/**
 * Synced blobs are untrusted input; `resolveAttachmentBlob` does the name,
 * hash, and magic-byte validation.
 */
export const getAttachmentBlob = async (input: GetAttachmentBlobInput) => {
	const bootResult = await bootLocal(input.repoRoot);
	if (isFail(bootResult)) return bootResult;

	return resolveAttachmentBlob(
		bootResult.value.stateBranchRoot,
		input.fileName,
		getAttachmentMaxKb(),
	);
};
