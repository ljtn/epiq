// The other repos whose commits count as the board's, as the repos panel
// reads and changes them. Configuration in `project.json` rather than board
// state, so nothing here goes through the mutation gate; a change that moves
// commits is announced to every client as `repos:changed`.

import {useCallback, useEffect, useState} from 'react';
import {GuiOwnRepo, GuiRepo} from './gui-state.model';
import {getResultValue} from './gui-state-helper';

export type ReposState = {
	data: GuiRepo[] | null;
	/** Sent with the list on request; kept across the answers that omit it. */
	own: GuiOwnRepo | null;
	/** What the last change came to, for the line under the list. */
	lastAction: {ok: boolean; message: string} | null;
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
		changed: 0,
	});

	// On connecting: chips and the repo filter read labels off the list before
	// the panel is ever opened.
	useEffect(() => {
		// Once per socket: the epoch moves to 1 as the first one opens.
		if (socketEpoch === 0) return;
		sendRaw({type: 'repos:get'});
	}, [sendRaw, socketEpoch]);

	useEffect(() => {
		if (!open) return;

		// On opening, and on a reconnect while open.
		setState(prev => ({...prev, lastAction: null}));
		sendRaw({type: 'repos:get'});
	}, [open, sendRaw, socketEpoch]);

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

			const value = getResultValue<GuiRepo[]>(message.payload);

			setState(prev => ({
				...prev,
				data: value ?? prev.data,
				own: message.own ?? prev.own,
				lastAction: message.lastAction
					? {
							ok: Boolean(message.lastAction.ok),
							message: String(message.lastAction.message),
					  }
					: value
					? prev.lastAction
					: {
							ok: false,
							message:
								message.payload?.message ?? 'Could not read the repo list',
					  },
			}));
		},
		[open, sendRaw],
	);

	const add = useCallback(
		(payload: {
			url: string;
			branches?: 'default' | 'all';
			since?: string;
			label?: string;
		}) => {
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

	return {...state, onMessage, add, remove};
};
