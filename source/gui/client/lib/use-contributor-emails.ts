// Which git addresses the board has bound to which contributors, and the one
// state nothing else reports: an address two people claim, which resolves to
// neither of them.

import {useCallback, useEffect, useState} from 'react';
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

export type ContributorEmailsState = {
	loading: boolean;
	data: ContributorEmails | null;
	/** What the last link or unlink said, kept so the panel can report it. */
	lastAction: {ok: boolean; message: string} | null;
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
		lastAction: null,
	});

	// Asked for when the panel opens and not polled: links change when somebody
	// makes one, and every reply to a change carries the new list with it.
	useEffect(() => {
		if (!open) return;

		setState(prev => ({...prev, loading: true, lastAction: null}));
		sendRaw({type: 'emails:get'});
	}, [open, sendRaw]);

	const onMessage = useCallback((message: any) => {
		if (message.type !== 'emails') return;

		const value = getResultValue<ContributorEmails>(message.payload);

		setState({
			loading: false,
			data: value ?? null,
			lastAction: message.lastAction ?? null,
		});
	}, []);

	const link = useCallback(
		(email: string, contributorId?: string) =>
			sendRaw({type: 'email:link', payload: {email, contributorId}}),
		[sendRaw],
	);

	const unlink = useCallback(
		(email: string, contributorId?: string) =>
			sendRaw({type: 'email:unlink', payload: {email, contributorId}}),
		[sendRaw],
	);

	return {...state, onMessage, link, unlink};
};
