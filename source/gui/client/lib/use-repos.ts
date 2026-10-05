// The other repos whose commits count as the board's, as the repos panel
// reads and changes them. Configuration in `project.json` rather than board
// state, so nothing here goes through the mutation gate; a change that moves
// commits is announced to every client as `repos:changed`.

import {useCallback, useEffect, useState} from 'react';
import {GuiRepo} from './gui-state.model';
import {getResultValue} from './gui-state-helper';

export type ReposState = {
	data: GuiRepo[] | null;
	/** What the last change or fetch came to, for the line under the list. */
	lastAction: {ok: boolean; message: string} | null;
	/** A fetch somebody started from the panel is still running. */
	fetching: boolean;
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
}: {
	open: boolean;
	sendRaw: (message: unknown) => void;
}) => {
	const [state, setState] = useState<ReposState>({
		data: null,
		lastAction: null,
		fetching: false,
		changed: 0,
	});

	useEffect(() => {
		if (!open) return;

		setState(prev => ({...prev, lastAction: null}));
		sendRaw({type: 'repos:get'});
	}, [open, sendRaw]);

	const onMessage = useCallback(
		(message: any) => {
			if (message.type === 'repos:changed') {
				setState(prev => ({...prev, changed: prev.changed + 1}));
				// A fetch that ran on another client's sync changes this panel's
				// clone status too.
				if (open) sendRaw({type: 'repos:get'});
				return;
			}

			if (message.type !== 'repos') return;

			const value = getResultValue<GuiRepo[]>(message.payload);

			setState(prev => ({
				...prev,
				data: value ?? prev.data,
				// Only an answer to something asked of the panel ends a fetch: a
				// refresh another client's sync set off carries no lastAction.
				fetching: message.lastAction ? false : prev.fetching,
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
			trust?: boolean;
		}) => {
			setState(prev => ({...prev, lastAction: null}));
			sendRaw({type: 'repo:add', payload});
		},
		[sendRaw],
	);

	const remove = useCallback(
		(repo: string) => {
			setState(prev => ({...prev, lastAction: null}));
			sendRaw({type: 'repo:remove', payload: {repo}});
		},
		[sendRaw],
	);

	const fetchNow = useCallback(() => {
		setState(prev => ({...prev, lastAction: null, fetching: true}));
		sendRaw({type: 'repos:fetch'});
	}, [sendRaw]);

	return {...state, onMessage, add, remove, fetchNow};
};
