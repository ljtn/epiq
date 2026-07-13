import {useEffect, useRef, useState} from 'react';
import {useNavigate, useParams, useSearchParams} from 'react-router-dom';
import {Button} from './components/Button';
import {CreateIssueModal} from './components/CreateIssueModal';
import {Dropdown} from './components/Dropdown';
import {Header} from './components/Header';
import {IssueDetails} from './components/IssueDetails';
import {SwimlaneColumn} from './components/SwimlaneColumn';
import {moveIssue} from './lib/gui-move-issue';
import {DropTarget} from './lib/gui-result.model';
import {nodeRef} from '../../lib/utils/node-ref.js';
import {
	findBoard,
	findIssue,
	getResultValue,
	updateIssueInGuiState,
} from './lib/gui-state-helper';
import {GuiState} from './lib/gui-state.model';
import {blobToBase64, compressImage} from './lib/compress-image';
import {AttachmentUploadStatus} from './components/IssueAttachments';
import {SyncStatus} from './lib/gui-sync-statusmodel';
import {GUI_THEME} from './lib/gui-theme';

type IssueDetailsTab = 'overview' | 'comments';

export const DropIndicator = () => (
	<div
		style={{
			height: 2,
			background: GUI_THEME.accent,
			borderRadius: 999,
			margin: '4px 8px 8px',
			boxShadow: `0 0 12px ${GUI_THEME.accent}`,
		}}
	/>
);

export const App = () => {
	const {boardId, issueId} = useParams<{
		boardId: string;
		issueId?: string;
	}>();

	const [searchParams, setSearchParams] = useSearchParams();

	const [connected, setConnected] = useState(false);
	const [syncStatus, setSyncStatus] = useState<SyncStatus>({
		status: 'synced',
		msg: 'idle',
	});
	const [state, setState] = useState<GuiState | null>(null);
	const [dragOverSwimlaneId, setDragOverSwimlaneId] = useState<string | null>(
		null,
	);
	const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
	const [boardMenuOpen, setBoardMenuOpen] = useState(false);
	const [createIssueModal, setCreateIssueModal] = useState<{
		swimlaneId: string;
		title: string;
	} | null>(null);

	const boardMenuRef = useRef<HTMLDivElement | null>(null);
	const socketRef = useRef<WebSocket | null>(null);

	const selectedTab =
		searchParams.get('tab') === 'comments' ? 'comments' : 'overview';
	const navigate = useNavigate();

	// Route params carry shorthand refs (full ids in old links still resolve).
	const selectedBoard =
		(state && boardId ? findBoard(state, boardId) : null) ??
		state?.boards[0] ??
		null;

	const boardSlug = selectedBoard?.ref ?? boardId;

	const selectedIssue = state && issueId ? findIssue(state, issueId) : null;

	// Paste-to-attach: the fastest screenshot flow. Text inputs keep their
	// native paste behavior.
	useEffect(() => {
		const onPaste = (event: ClipboardEvent) => {
			if (!selectedIssue || selectedIssue.readonly) return;

			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === 'INPUT' ||
					target.tagName === 'TEXTAREA' ||
					target.isContentEditable)
			) {
				return;
			}

			const files = Array.from(event.clipboardData?.items ?? [])
				.filter(item => item.kind === 'file' && item.type.startsWith('image/'))
				.map(item => item.getAsFile())
				.filter((file): file is File => Boolean(file));

			if (files.length === 0) return;

			event.preventDefault();
			void uploadIssueAttachments(selectedIssue.id, files);
		};

		window.addEventListener('paste', onPaste);
		return () => window.removeEventListener('paste', onPaste);
	});

	const closeIssueDetails = () => {
		if (!boardSlug) return;

		void navigate(`/board/${boardSlug}`);
	};

	const commentsByIssueId = state?.commentsByIssueId ?? {};
	const attachmentsByIssueId = state?.attachmentsByIssueId ?? {};
	const [attachmentUploadStatus, setAttachmentUploadStatus] =
		useState<AttachmentUploadStatus>({state: 'idle'});

	const requestState = () => {
		socketRef.current?.send(JSON.stringify({type: 'state:get'}));
	};

	useEffect(() => {
		const socket = new WebSocket(
			`ws://${window.location.host}/ws${boardId ? `?boardId=${boardId}` : ''}`,
		);

		socketRef.current = socket;

		socket.addEventListener('open', () => {
			setConnected(true);
			socket.send(JSON.stringify({type: 'state:get'}));
		});

		socket.addEventListener('close', () => {
			setConnected(false);

			if (socketRef.current === socket) {
				socketRef.current = null;
			}
		});

		socket.addEventListener('message', event => {
			const message = JSON.parse(event.data);

			if (message.type === 'state') {
				const nextState = getResultValue<GuiState>(message.payload);
				if (nextState) setState(nextState);
			}

			if (message.type === 'issue:created') {
				const created = getResultValue<{id: string}>(message.payload);

				if (created && boardId) {
					void navigate(
						`/board/${boardId}/issue/${nodeRef(created.id)}?tab=overview`,
					);
				}
			}

			if (message.type === 'failed') {
				console.log('Failed', message);
				requestState();
			}

			if (message.type === 'sync-status') {
				setSyncStatus(message.payload);
			}
		});

		return () => {
			if (socketRef.current === socket) {
				socketRef.current = null;
			}

			socket.close();
		};
	}, [boardId, navigate]);

	useEffect(() => {
		if (!boardId && state?.boards[0]) {
			void navigate(`/board/${state.boards[0].ref}`, {replace: true});
		}
	}, [boardId, state, navigate]);

	useEffect(() => {
		const close = (event: MouseEvent) => {
			if (
				boardMenuRef.current &&
				!boardMenuRef.current.contains(event.target as Node)
			) {
				setBoardMenuOpen(false);
			}
		};

		document.addEventListener('mousedown', close);
		return () => document.removeEventListener('mousedown', close);
	}, []);

	const clearDragState = () => {
		setDragOverSwimlaneId(null);
		setDropTarget(null);
	};

	const send = (type: string, payload: unknown) => {
		socketRef.current?.send(JSON.stringify({type, payload}));
	};

	const selectIssue = (nextIssueId: string) => {
		if (!boardSlug) return;

		void navigate(
			`/board/${boardSlug}/issue/${nodeRef(nextIssueId)}?tab=overview`,
		);
	};

	const selectIssueComments = (nextIssueId: string) => {
		if (!boardSlug) return;

		void navigate(
			`/board/${boardSlug}/issue/${nodeRef(nextIssueId)}?tab=comments`,
		);
	};

	const changeIssueDetailsTab = (nextTab: IssueDetailsTab) => {
		setSearchParams(
			prev => {
				const next = new URLSearchParams(prev);
				next.set('tab', nextTab);
				return next;
			},
			{replace: true},
		);
	};

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

	const addIssueAssignee = (issueId: string, assigneeName: string) => {
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

		send('issue:assignee:add', {issueId, assigneeName});
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

	const selectBoard = (nextBoardId: string) => {
		setBoardMenuOpen(false);
		clearDragState();

		void navigate(`/board/${nodeRef(nextBoardId)}`);
	};

	const openCreateIssueModal = (swimlaneId: string) => {
		setCreateIssueModal({
			swimlaneId,
			title: '',
		});
	};

	const createIssue = () => {
		if (!createIssueModal) return;

		const title = createIssueModal.title.trim() || 'New issue';
		const parentId = createIssueModal.swimlaneId;

		setCreateIssueModal(null);

		send('issues:create', {
			title,
			parentId,
		});
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

	const uploadIssueAttachments = async (issueId: string, files: File[]) => {
		for (const file of files) {
			setAttachmentUploadStatus({state: 'uploading', name: file.name});

			const compressed = await compressImage(file, state?.attachmentMaxKb);

			if ('error' in compressed) {
				setAttachmentUploadStatus({state: 'error', message: compressed.error});
				return;
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
					return;
				}

				const nextState = getResultValue<GuiState>(payload);
				if (nextState) setState(nextState);
			} catch (error) {
				setAttachmentUploadStatus({
					state: 'error',
					message: error instanceof Error ? error.message : 'Upload failed',
				});
				return;
			}
		}

		setAttachmentUploadStatus({state: 'idle'});
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

	const deleteIssueComment = (_issueId: string, commentId: string) => {
		setState(prev => {
			if (!prev) return prev;

			return {
				...prev,
				commentsByIssueId: Object.fromEntries(
					Object.entries(prev.commentsByIssueId).map(
						([nextIssueId, comments]) => [
							nextIssueId,
							comments.filter(comment => comment.id !== commentId),
						],
					),
				),
			};
		});

		send('issue:comment:delete', {commentId});
	};

	return (
		<div
			style={{
				height: '100vh',
				background: GUI_THEME.bg,
				color: GUI_THEME.primary,
				fontFamily:
					'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
				display: 'flex',
				flexDirection: 'column',
			}}
		>
			<Header state={state} connected={connected} syncStatus={syncStatus} />

			<div
				style={{
					display: 'flex',
					flex: 1,
					overflow: 'hidden',
				}}
			>
				<main style={{padding: '0 30px 30px 30px', overflow: 'auto', flex: 1}}>
					<div style={{padding: '20px 10px'}}>
						<Dropdown
							label="Board:"
							value={
								selectedBoard
									? {
											id: selectedBoard.id,
											label: selectedBoard.title,
									  }
									: null
							}
							items={
								state?.boards.map(board => ({
									id: board.id,
									label: board.title,
								})) ?? []
							}
							placeholder="Loading..."
							onSelect={selectBoard}
						/>
					</div>

					<div style={{display: 'flex', gap: 8}}>
						{selectedBoard?.swimlanes.map(swimlane => (
							<SwimlaneColumn
								key={swimlane.id}
								swimlane={swimlane}
								selected={false}
								selectedIssueId={selectedIssue?.id ?? null}
								commentsByIssueId={commentsByIssueId}
								dragOver={dragOverSwimlaneId === swimlane.id}
								dropIndex={
									dropTarget?.swimlaneId === swimlane.id
										? dropTarget.index
										: null
								}
								onSelectIssue={selectIssue}
								onSelectIssueComments={selectIssueComments}
								onCreateIssue={openCreateIssueModal}
								onDropIssue={moveIssue(setState, socketRef)}
								onDragOver={setDragOverSwimlaneId}
								onDragOverIssue={(swimlaneId, index) =>
									setDropTarget({swimlaneId, index})
								}
								onDragLeave={clearDragState}
							/>
						))}
					</div>
				</main>

				{selectedIssue && state?.user && (
					<IssueDetails
						whoAmI={state.user}
						issue={selectedIssue}
						activeTab={selectedTab}
						comments={commentsByIssueId[selectedIssue.id] ?? []}
						onChangeTab={changeIssueDetailsTab}
						onClose={closeIssueDetails}
						onEditTitle={editIssueTitle}
						onEditDescription={editIssueDescription}
						onAddTag={addIssueTag}
						onRemoveTag={removeIssueTag}
						onAddAssignee={addIssueAssignee}
						onRemoveAssignee={removeIssueAssignee}
						onAddComment={addIssueComment}
						onDeleteComment={deleteIssueComment}
						attachments={attachmentsByIssueId[selectedIssue.id] ?? []}
						attachmentUploadStatus={attachmentUploadStatus}
						onUploadAttachments={uploadIssueAttachments}
						onDeleteAttachment={deleteIssueAttachment}
						onReopenIssue={reopenIssue}
						onCloseIssue={closeIssue}
						knownTags={state.tags ?? []}
						knownAssignees={state.contributors ?? []}
					/>
				)}
			</div>

			{createIssueModal && (
				<CreateIssueModal
					title={createIssueModal.title}
					onChangeTitle={title =>
						setCreateIssueModal(prev => (prev ? {...prev, title} : prev))
					}
					onCreate={createIssue}
					onClose={() => setCreateIssueModal(null)}
				/>
			)}
		</div>
	);
};
