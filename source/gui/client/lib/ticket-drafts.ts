import {useCallback, useEffect, useRef, useSyncExternalStore} from 'react';

// Text a ticket's boxes hold but have not sent, kept here rather than in the
// boxes so it outlives them: a tab switch, the film or a diff in front of the
// panel all unmount the box, and none of them is leaving the ticket. Only
// leaving the ticket discards it, and the board asks first.

type Draft = {value: unknown; dirty: boolean};

// A value, or a function of the current one for a write that lands later, as
// an image upload's does.
type Update<T> = T | undefined | ((current: T | undefined) => T | undefined);

const drafts = new Map<string, Map<string, Draft>>();
const listeners = new Set<() => void>();

const notify = () => {
	for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const hasTicketDrafts = (issueId: string): boolean =>
	[...(drafts.get(issueId)?.values() ?? [])].some(draft => draft.dirty);

export const discardTicketDrafts = (issueId: string) => {
	if (drafts.delete(issueId)) notify();
};

// One slot of one ticket: undefined until something is put in it. `isDirty`
// says whether a value would be lost by leaving, which an untouched edit is
// not.
export const useTicketDraft = <T>(
	issueId: string,
	slot: string,
	isDirty: (value: T) => boolean,
): [T | undefined, (next: Update<T>) => void] => {
	const value = useSyncExternalStore(
		subscribe,
		() => drafts.get(issueId)?.get(slot)?.value as T | undefined,
	);

	const isDirtyRef = useRef(isDirty);
	isDirtyRef.current = isDirty;

	const setValue = useCallback(
		(update: Update<T>) => {
			const slots = drafts.get(issueId) ?? new Map<string, Draft>();
			const next =
				typeof update === 'function'
					? (update as (current: T | undefined) => T | undefined)(
							slots.get(slot)?.value as T | undefined,
					  )
					: update;

			if (next === undefined) slots.delete(slot);
			else slots.set(slot, {value: next, dirty: isDirtyRef.current(next)});

			if (slots.size > 0) drafts.set(issueId, slots);
			else drafts.delete(issueId);

			notify();
		},
		[issueId, slot],
	);

	return [value, setValue];
};

// An edit of a value somebody else can change meanwhile, which remembers what
// it opened with. Untouched, it follows the value and has nothing to save;
// touched, it is the reader's.
export const useEditDraft = (
	issueId: string,
	slot: string,
	current: string,
) => {
	const [draft, setDraft] = useTicketDraft<{text: string; original: string}>(
		issueId,
		slot,
		edit => edit.text !== edit.original,
	);

	useEffect(() => {
		if (draft && draft.text === draft.original && draft.original !== current) {
			setDraft({text: current, original: current});
		}
	}, [draft, current, setDraft]);

	return {
		editing: draft !== undefined,
		text: draft?.text ?? '',
		changed: draft !== undefined && draft.text !== draft.original,
		setText: (update: string | ((text: string) => string)) =>
			setDraft(edit =>
				edit
					? {
							...edit,
							text: typeof update === 'function' ? update(edit.text) : update,
					  }
					: undefined,
			),
		start: () => setDraft({text: current, original: current}),
		stop: () => setDraft(undefined),
	};
};
