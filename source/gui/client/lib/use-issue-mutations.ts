// The ticket panel's writes. Each applies its change to the board on screen
// first and then tells the server, so the panel never waits on the round trip;
// the state that follows replaces the placeholder. Attachments go over HTTP
// rather than the socket and carry their own upload status.

import {Dispatch, SetStateAction, useState} from 'react';
import {blobToBase64, compressImage} from './compress-image';
import {getResultValue, updateIssueInGuiState} from './gui-state-helper';
import {GuiContributor, GuiState} from './gui-state.model';
import {GUI_THEME} from './gui-theme';
import {BoardSocketActions} from './use-board-socket';
import {IssueDetailPanel} from './use-issue-detail';

export type AttachmentUploadStatus =
	| {state: 'idle'}
	| {state: 'uploading'; name: string}
	| {state: 'error'; message: string};

export const useIssueMutations = ({
	send,
	setState,
	contributors,
	updateComments,
	attachmentMaxKb,
}: {
	send: BoardSocketActions['send'];
	setState: Dispatch<SetStateAction<GuiState | null>>;
	contributors: GuiContributor[];
	updateComments: IssueDetailPanel['updateComments'];
	attachmentMaxKb: GuiState['attachmentMaxKb'] | undefined;
}) => {
	const [attachmentUploadStatus, setAttachmentUploadStatus] =
		useState<AttachmentUploadStatus>({state: 'idle'});

	const editIssueTitle = (issueId: string, title: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => ({
				...issue,
				title,
			}));
		});

		send('issue:edit:title', {issueId, title});
	};

	const editIssueDescription = (issueId: string, description: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => ({
				...issue,
				description,
			}));
		});

		send('issue:edit:description', {issueId, description});
	};

	const addIssueTag = (issueId: string, tagName: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => {
				if (issue.tags.some(tag => tag.name === tagName)) return issue;

				return {
					...issue,
					tags: [
						...issue.tags,
						{
							id: `placeholder-tag-${tagName}`,
							name: tagName,
							color: GUI_THEME.dim,
						},
					],
				};
			});
		});

		send('issue:tag:add', {issueId, tagName});
	};

	const removeIssueTag = (issueId: string, tagId: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => ({
				...issue,
				tags: issue.tags.filter(tag => tag.id !== tagId),
			}));
		});

		send('issue:tag:remove', {issueId, tagId});
	};

	const addIssueAssignee = (issueId: string, assigneeId: string) => {
		const picked = contributors.find(c => c.id === assigneeId);

		setState(prev => {
			if (!prev || !picked) return prev;

			return updateIssueInGuiState(prev, issueId, issue =>
				issue.assignees.some(assignee => assignee.id === assigneeId)
					? issue
					: {...issue, assignees: [...issue.assignees, picked]},
			);
		});

		send('issue:assignee:add', {issueId, assigneeId});
	};

	// Clears the display name only; the id and every assignment survive.
	const removeContributor = (contributorId: string) => {
		send('contributor:remove', {contributorId});
	};

	// Hides the tag everywhere; the id and every ticket reference survive. The
	// state broadcast that follows drops it from every card at once.
	const removeTag = (tagId: string) => {
		send('tag:remove', {tagId});
	};

	// Invent a person who has no record at all in the in the event logs.
	const addExternalIssueAssignee = (issueId: string, assigneeName: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => {
				if (issue.assignees.some(assignee => assignee.name === assigneeName)) {
					return issue;
				}

				return {
					...issue,
					assignees: [
						...issue.assignees,
						{
							id: `placeholder-assignee-${assigneeName}`,
							name: assigneeName,
							color: GUI_THEME.dim,
						},
					],
				};
			});
		});

		send('issue:assignee:add', {issueId, assigneeName, createUnlinked: true});
	};

	const removeIssueAssignee = (issueId: string, assigneeId: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => ({
				...issue,
				assignees: issue.assignees.filter(
					assignee => assignee.id !== assigneeId,
				),
			}));
		});

		send('issue:assignee:remove', {issueId, assigneeId});
	};

	const closeIssue = (issueId: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => ({
				...issue,
				isClosed: true,
			}));
		});

		send('issue:close', {issueId});
	};

	const reopenIssue = (issueId: string) => {
		setState(prev => {
			if (!prev) return prev;

			return updateIssueInGuiState(prev, issueId, issue => ({
				...issue,
				isClosed: false,
			}));
		});

		send('issue:reopen', {issueId});
	};

	const addIssueComment = (issueId: string, body: string) => {
		setState(prev => {
			if (!prev) return prev;

			const previousComments = prev.commentsByIssueId[issueId] ?? [];
			const placeholderComment = {
				id: `placeholder-comment-${crypto.randomUUID()}`,
				issueId,
				body,
				isDeleted: false,
				author: prev.user,
				createdAt: new Date().getTime(),
			} as (typeof previousComments)[number];

			return {
				...prev,
				commentsByIssueId: {
					...prev.commentsByIssueId,
					[issueId]: [...previousComments, placeholderComment],
				},
			};
		});

		send('issue:comment:add', {issueId, body});
	};

	// Returns one markdown reference per file that made it, so a composer can
	// leave them at the cursor. A rejected file contributes nothing and the
	// error is reported through attachmentUploadStatus as before.
	const uploadIssueAttachments = async (
		issueId: string,
		files: File[],
	): Promise<string[]> => {
		const inserted: string[] = [];

		for (const file of files) {
			setAttachmentUploadStatus({state: 'uploading', name: file.name});

			const compressed = await compressImage(file, attachmentMaxKb);

			if ('error' in compressed) {
				setAttachmentUploadStatus({state: 'error', message: compressed.error});
				return inserted;
			}

			try {
				const dataBase64 = await blobToBase64(compressed.blob);

				const response = await fetch('/api/attachments', {
					method: 'POST',
					headers: {'content-type': 'application/json'},
					body: JSON.stringify({
						issueId,
						name: compressed.name,
						dataBase64,
					}),
				});

				const payload = await response.json();

				if (!response.ok) {
					setAttachmentUploadStatus({
						state: 'error',
						message: payload?.message ?? 'Upload failed',
					});
					return inserted;
				}

				const nextState = getResultValue<GuiState>(payload);
				if (nextState) setState(nextState);

				const markdown = (payload as {attachment?: {markdown?: string}})
					?.attachment?.markdown;
				if (markdown) inserted.push(markdown);
			} catch (error) {
				setAttachmentUploadStatus({
					state: 'error',
					message: error instanceof Error ? error.message : 'Upload failed',
				});
				return inserted;
			}
		}

		setAttachmentUploadStatus({state: 'idle'});

		return inserted;
	};

	const deleteIssueAttachment = async (
		_issueId: string,
		attachmentId: string,
	) => {
		try {
			const response = await fetch(
				`/api/attachments/${encodeURIComponent(attachmentId)}`,
				{method: 'DELETE'},
			);

			const payload = await response.json();

			if (!response.ok) {
				setAttachmentUploadStatus({
					state: 'error',
					message: payload?.message ?? 'Unable to delete attachment',
				});
				return;
			}

			const nextState = getResultValue<GuiState>(payload);
			if (nextState) setState(nextState);
		} catch (error) {
			setAttachmentUploadStatus({
				state: 'error',
				message:
					error instanceof Error
						? error.message
						: 'Unable to delete attachment',
			});
		}
	};

	const deleteIssueComment = (issueId: string, commentId: string) => {
		updateComments(issueId, comments =>
			comments.filter(comment => comment.id !== commentId),
		);

		send('issue:comment:delete', {issueId, commentId});
	};

	const editIssueComment = (
		issueId: string,
		commentId: string,
		body: string,
	) => {
		updateComments(issueId, comments =>
			comments.map(comment =>
				comment.id === commentId ? {...comment, body} : comment,
			),
		);

		send('issue:comment:edit', {issueId, commentId, body});
	};

	return {
		attachmentUploadStatus,
		editIssueTitle,
		editIssueDescription,
		addIssueTag,
		removeIssueTag,
		addIssueAssignee,
		removeContributor,
		removeTag,
		addExternalIssueAssignee,
		removeIssueAssignee,
		closeIssue,
		reopenIssue,
		addIssueComment,
		deleteIssueComment,
		editIssueComment,
		uploadIssueAttachments,
		deleteIssueAttachment,
	};
};
