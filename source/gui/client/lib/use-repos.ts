// The other repos whose commits count as the board's, as the repos panel
// reads and changes them. They are board events: a new repo is previewed from
// a staged clone first and connected only on a confirm, while an option change
// on a connected one is written at once. A change that moves commits is
// announced to every client as `repos:changed`.

import {useCallback, useEffect, useRef, useState} from 'react';
import {GuiOwnRepo, GuiRepoList, GuiRepoPreview} from './gui-state.model';
import {getResultValue} from './gui-state-helper';

export type RepoConnectPayload = {
	url: string;
	branches?: 'default' | 'all';
	since?: string;
	label?: string;
};

export type ReposState = {
	data: GuiRepoList | null;
	/** Sent with the list on request; kept across the answers that omit it. */
	own: GuiOwnRepo | null;
	/** What the last change came to, for the line under the list. */
	lastAction: {ok: boolean; message: string} | null;
	/** A new repo staged and described, waiting for a confirm or a cancel. */
	preview: GuiRepoPreview | null;
	/** A preview being cloned, or its confirm being written. */
	pending: 'preview' | 'confirm' | null;
	/**
	 * Bumped each time another repo's commits may have moved, so whatever
	 * draws commits asks for them again. They come from git; no board state
	 * carries the change.
	 */
	changed: number;
};

export const useRepos = ({
	open,
	sendRaw,
	socketEpoch,
}: {
	open: boolean;
	sendRaw: (message: unknown) => void;
	/** Bumped on each reconnect: an answer owed to the old socket never comes. */
	socketEpoch: number;
}) => {
	const [state, setState] = useState<ReposState>({
		data: null,
		own: null,
		lastAction: null,
		preview: null,
		pending: null,
		changed: 0,
	});
	// The confirm sends what the preview was made with: the server checks the
	// staged clone against the same options.
	const previewed = useRef<RepoConnectPayload | null>(null);
	const pending = useRef<ReposState['pending']>(null);
	const previewId = useRef<string | null>(null);
	previewId.current = state.preview?.repo.id ?? null;

	/** Abandons the preview, or the clone still being made for one. */
	const cancelPreview = useCallback(() => {
		const cloning = pending.current === 'preview' ? previewed.current : null;
		const repo = previewId.current;
		previewed.current = null;
		pending.current = null;
		setState(prev => ({...prev, preview: null, pending: null}));

		if (cloning) {
			sendRaw({type: 'repo:preview:cancel', payload: {url: cloning.url}});
		} else if (repo) {
			sendRaw({type: 'repo:preview:cancel', payload: {repo}});
		}
	}, [sendRaw]);

	// On connecting: chips and the repo filter read labels off the list before
	// the panel is ever opened.
	useEffect(() => {
		// Once per socket: the epoch moves to 1 as the first one opens.
		if (socketEpoch === 0) return;
		pending.current = null;
		setState(prev => ({...prev, pending: null}));
		sendRaw({type: 'repos:get'});
	}, [sendRaw, socketEpoch]);

	useEffect(() => {
		if (!open) {
			// Closing the panel frees a preview's staged clone, or stops its clone.
			if (previewId.current || pending.current === 'preview') cancelPreview();
			return;
		}

		// On opening, and on a reconnect while open.
		setState(prev => ({...prev, lastAction: null}));
		sendRaw({type: 'repos:get'});
	}, [open, sendRaw, socketEpoch, cancelPreview]);

	const onMessage = useCallback(
		(message: any) => {
			if (message.type === 'repos:changed') {
				setState(prev => ({...prev, changed: prev.changed + 1}));
				// The list itself may have moved: a label, an option, a repo gone.
				sendRaw({type: 'repos:get'});
				return;
			}

			// A sync's fetch failed or moved a repo: the list's statuses moved.
			if (message.type === 'repos:fetched') {
				if (open) sendRaw({type: 'repos:get'});
				return;
			}

			if (message.type !== 'repos') return;

			const value = getResultValue<GuiRepoList>(message.payload);
			const preview: GuiRepoPreview | null = message.preview ?? null;
			const action: {ok: boolean; message: string} | null = message.lastAction
				? {
						ok: Boolean(message.lastAction.ok),
						message: String(message.lastAction.message),
				  }
				: null;

			// Only the answer to the preview being waited on ends it: one for a
			// clone since cancelled, or for another URL, is dropped.
			const settled =
				message.for === 'repo:preview'
					? pending.current === 'preview' &&
					  message.url === previewed.current?.url.trim()
					: message.for === 'repo:connect' && pending.current === 'confirm';
			const stale = message.for === 'repo:preview' && !settled;

			if (settled) {
				pending.current = null;
				if (!preview) previewed.current = null;
			}

			setState(prev => ({
				...prev,
				data: value ?? prev.data,
				own: message.own ?? prev.own,
				preview: settled ? preview : prev.preview,
				pending: settled ? null : prev.pending,
				lastAction: stale
					? prev.lastAction
					: action ??
					  (value
							? prev.lastAction
							: {
									ok: false,
									message:
										message.payload?.message ?? 'Could not read the repo list',
							  }),
			}));
		},
		[open, sendRaw],
	);

	/** Stages a new repo and describes it; nothing is written. */
	const previewRepo = useCallback(
		(payload: RepoConnectPayload) => {
			previewed.current = payload;
			pending.current = 'preview';
			setState(prev => ({
				...prev,
				lastAction: null,
				preview: null,
				pending: 'preview',
			}));
			sendRaw({type: 'repo:preview', payload});
		},
		[sendRaw],
	);

	const confirmPreview = useCallback(() => {
		if (!previewed.current || pending.current) return;

		pending.current = 'confirm';
		setState(prev => ({...prev, lastAction: null, pending: 'confirm'}));
		sendRaw({type: 'repo:connect', payload: previewed.current});
	}, [sendRaw]);

	/** A connected repo's label, branches or window: applied at once. */
	const change = useCallback(
		(payload: RepoConnectPayload) => {
			setState(prev => ({...prev, lastAction: null}));
			sendRaw({type: 'repo:connect', payload});
		},
		[sendRaw],
	);

	const remove = useCallback(
		(repo: string) => {
			setState(prev => ({...prev, lastAction: null}));
			sendRaw({type: 'repo:disconnect', payload: {repo}});
		},
		[sendRaw],
	);

	return {
		...state,
		onMessage,
		previewRepo,
		confirmPreview,
		cancelPreview,
		change,
		remove,
	};
};
