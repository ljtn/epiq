// Which git addresses are bound to which contributors, including addresses two
// people claim, which resolve to neither.

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
	/** This repository's git address and its state; null where none is set. */
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
	 * Why the history could not be read. Distinct from an empty list, which would
	 * read as nothing left to claim.
	 */
	scanError: string | null;
	/** Why the last claim or unclaim failed; successes show in the list. */
	lastError: string | null;
	/** Bumped when a claim lands, since the commit track is fetched from git. */
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

	// Whether our link or unlink is in flight, since `failed` is broadcast for any
	// mutation on any socket.
	const pending = useRef(false);

	// Asked for when the panel opens and not polled: links change when somebody
	// makes one, and every reply to a change carries the new list with it.
	useEffect(() => {
		if (!open) return;

		setState(prev => ({...prev, loading: true, lastAction: null}));
		sendRaw({type: 'emails:get'});
	}, [open, sendRaw]);

	const onMessage = useCallback((message: any) => {
		// The server's mutation guard answers `failed`, e.g. while scrubbing.
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

		// A failed read is not an empty board.
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
