// What a ticket ref shows on hover. Only the description is fetched (the
// broadcast strips it), once per ticket.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {getResultValue} from './gui-state-helper';
import {GuiState, GuiTag, GuiUser} from './gui-state.model';

export type TicketPreview = {
	issueId: string;
	ref: string;
	title: string;
	board: string;
	lane: string;
	isClosed: boolean;
	tags: GuiTag[];
	assignees: GuiUser[];
	commentCount: number;
	// Absent while the fetch is in flight. An empty string is an answer — the
	// ticket has no description — and the card says so rather than spinning.
	excerpt?: string;
};

type Summary = Omit<TicketPreview, 'excerpt'>;

type Held = {
	excerpt: string;
	// The state it was read from; a later one asks again while still drawing this.
	from: GuiState;
};

export type TicketPreviews = {
	previewFor: (ref: string) => TicketPreview | null;
	// Called when a ref is hovered: fetches the excerpt unless one already
	// describes the state on screen.
	requestPreview: (ref: string) => void;
	onMessage: (message: any) => void;
};

const summarise = (state: GuiState | null): Map<string, Summary> => {
	const byRef = new Map<string, Summary>();
	if (!state) return byRef;

	for (const board of state.boards ?? []) {
		for (const lane of board.swimlanes ?? []) {
			for (const issue of lane.issues ?? []) {
				byRef.set(issue.ref, {
					issueId: issue.id,
					ref: issue.ref,
					title: issue.title,
					board: board.title,
					lane: lane.title,
					isClosed: issue.isClosed,
					tags: issue.tags ?? [],
					assignees: issue.assignees ?? [],
					commentCount: (state.commentsByIssueId?.[issue.id] ?? []).length,
				});
			}
		}
	}

	return byRef;
};

export const useTicketPreviews = ({
	state,
	sendRaw,
}: {
	state: GuiState | null;
	sendRaw: (message: unknown) => void;
}): TicketPreviews => {
	const [held, setHeld] = useState<Record<string, Held>>({});

	// A ref, not state: a request in flight must not redraw anything, and the
	// only question asked of it is whether to send a second one.
	const inFlight = useRef(new Set<string>());

	// Cleared on each new state, so a lost reply doesn't mark a ticket asked forever.
	useEffect(() => {
		inFlight.current.clear();
	}, [state]);

	const byRef = useMemo(() => summarise(state), [state]);

	const previewFor = useCallback(
		(ref: string): TicketPreview | null => {
			const summary = byRef.get(ref);
			if (!summary) return null;

			return {...summary, excerpt: held[summary.issueId]?.excerpt};
		},
		[byRef, held],
	);

	const requestPreview = useCallback(
		(ref: string) => {
			const summary = byRef.get(ref);
			if (!summary) return;

			const {issueId} = summary;
			if (held[issueId]?.from === state) return;
			if (inFlight.current.has(issueId)) return;

			inFlight.current.add(issueId);
			sendRaw({type: 'issue:preview:get', payload: {issueId}});
		},
		[byRef, held, state, sendRaw],
	);

	const onMessage = useCallback(
		(message: any) => {
			if (message.type !== 'issue:preview:result') return;

			// Wrapped with its issueId, since a failed Result carries none.
			const {issueId, result} = message.payload as {
				issueId: string;
				result: {
					status: string;
					message: string;
					value?: {issueId: string; excerpt: string};
				};
			};

			inFlight.current.delete(issueId);

			const next = getResultValue<{issueId: string; excerpt: string}>(result);
			if (!next) return;

			// Stamped with the state on screen, which the reply describes.
			setHeld(prev =>
				state
					? {...prev, [next.issueId]: {excerpt: next.excerpt, from: state}}
					: prev,
			);
		},
		[state],
	);

	return {previewFor, requestPreview, onMessage};
};
