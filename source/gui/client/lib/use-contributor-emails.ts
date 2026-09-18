// Which git addresses the board has bound to which contributors, and the one
// state nothing else reports: an address two people claim, which resolves to
// neither of them.

import {useCallback, useEffect, useRef, useState} from 'react';
import {GuiIdentity} from './gui-state.model';
import {getResultValue} from './gui-state-helper';

export type EmailClaim = {
	email: string;
	contested: boolean;
	claimants: GuiIdentity[];
};

export type ContributorEmails = {
	emails: EmailClaim[];
	/** The addresses the viewer holds, so the panel can say which are theirs. */
	mine: string[];
	/**
	 * This repository's own git address and what has become of it. Null where
	 * git has none configured.
	 */
	git: {
		email: string;
		linkedToMe: boolean;
		/** Anybody else claiming it, which is why it may not have linked itself. */
		heldByOthers: GuiIdentity[];
	} | null;
};

/** An address in the history that nobody has claimed. */
export type EmailCandidate = {
	email: string;
	names: string[];
	commits: number;
	looksLikeYours: boolean;
};

export type ContributorEmailsState = {
	loading: boolean;
	data: ContributorEmails | null;
	/** What this repository's history offers, for claiming without typing. */
	candidates: EmailCandidate[];
	/**
	 * Why the history could not be read, when it could not. Distinct from an
	 * empty list: with nothing linking itself, this list is the only way to
	 * claim an address, so a failed scan must not read as nothing left to claim.
	 */
	scanError: string | null;
	/**
	 * Why the last claim or unclaim failed, when it did. Only a failure: a claim
	 * that worked shows in the list itself, and no other panel in this GUI
	 * reports its own successes back.
	 */
	lastError: string | null;
	/**
	 * Bumped when a claim or unclaim lands. The commit track is fetched from git
	 * rather than derived from board state, so nothing else brings it back.
	 */
	changed: number;
};

export const useContributorEmails = ({
	open,
	sendRaw,
}: {
	open: boolean;
	sendRaw: (message: unknown) => void;
}) => {
	const [state, setState] = useState<ContributorEmailsState>({
		loading: false,
		data: null,
		candidates: [],
		scanError: null,
		lastError: null,
		changed: 0,
	});

	// Whether a link or unlink of ours is in flight. `failed` is a broadcast for
	// any mutation on any socket, so without this the panel reported somebody
	// else's error as its own — and the one failure it must not miss, the
	// read-only gate while scrubbing, is refused before it reaches the email
	// handler and so never produces an `emails` reply to carry the reason.
	const pending = useRef(false);

	// Asked for when the panel opens and not polled: links change when somebody
	// makes one, and every reply to a change carries the new list with it.
	useEffect(() => {
		if (!open) return;

		setState(prev => ({...prev, loading: true, lastAction: null}));
		sendRaw({type: 'emails:get'});
	}, [open, sendRaw]);

	const onMessage = useCallback((message: any) => {
		// The server's guard on mutating messages answers `failed` — while
		// scrubbing history, for instance. Ignoring it left the Link button doing
		// nothing at all with nothing said.
		if (message.type === 'failed') {
			if (!pending.current) return;

			pending.current = false;
			setState(prev => ({
				...prev,
				loading: false,
				lastError: String(message.payload),
			}));
			return;
		}

		if (message.type !== 'emails') return;

		pending.current = false;

		const suggestions = message.suggestions;
		const suggested =
			getResultValue<{candidates: EmailCandidate[]}>(suggestions)?.candidates ??
			[];
		const scanError =
			suggestions?.status === 'fail'
				? String(suggestions.message ?? 'Could not read this history')
				: null;

		const value = getResultValue<ContributorEmails>(message.payload);

		// A failed read is not an empty board. Without this the panel showed its
		// cheerful "none linked yet" for what was actually an error.
		if (!value) {
			setState(prev => ({
				...prev,
				loading: false,
				lastError:
					message.payload?.message ?? 'Could not read linked addresses',
			}));
			return;
		}

		setState(prev => ({
			loading: false,
			data: value,
			candidates: suggested,
			scanError,
			lastError:
				message.lastAction && !message.lastAction.ok
					? String(message.lastAction.message)
					: null,
			changed:
				message.lastAction?.ok === true ? prev.changed + 1 : prev.changed,
		}));
	}, []);

	// Both clear `lastAction` and raise `loading`, so the panel shows the round
	// trip rather than the previous answer until the reply lands.
	const link = useCallback(
		(email: string, contributorId?: string) => {
			pending.current = true;
			setState(prev => ({...prev, loading: true, lastError: null}));
			sendRaw({type: 'email:link', payload: {email, contributorId}});
		},
		[sendRaw],
	);

	const unlink = useCallback(
		(email: string, contributorId?: string) => {
			pending.current = true;
			setState(prev => ({...prev, loading: true, lastError: null}));
			sendRaw({type: 'email:unlink', payload: {email, contributorId}});
		},
		[sendRaw],
	);

	return {...state, onMessage, link, unlink};
};
