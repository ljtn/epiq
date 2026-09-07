import {useCallback, useEffect, useMemo, useRef} from 'react';
import {useSearchParams} from 'react-router-dom';
import {
	applySelectionPatch,
	BoardSelection,
	carryChange,
	carryRender,
	DEFAULT_CARRY,
	hasSelectionParams,
	isDefaultSelection,
	readSelectionParams,
	readStoredSelection,
	SelectionCarry,
	storeSelection,
	writeSelectionParams,
} from './board-selection';

// The URL wins when it says anything; a bare board link falls back to what
// was last used here, and gets that written into the address bar so copying
// it always hands over what is on screen. Either way storage follows the URL.
export const useBoardSelection = (): [
	BoardSelection,
	(patch: Partial<BoardSelection>) => void,
] => {
	const [searchParams, setSearchParams] = useSearchParams();

	const fromUrl = hasSelectionParams(searchParams);

	// The four storage does not keep, carried across the routes of this session
	// instead. A reload still starts wide, unzoomed and at the present — where
	// somebody is looking is a moment, not a preference to restore.
	//
	// The ticket narrowing travels with them, so it follows to whichever ticket
	// is opened next and re-derives there rather than being cancelled by the
	// click that moved between them.
	const carried = useRef<SelectionCarry>(DEFAULT_CARRY);

	const query = searchParams.toString();

	const selection = useMemo(() => {
		const fromParams = readSelectionParams(searchParams);

		return fromParams ?? {...readStoredSelection(), ...carried.current.values};
	}, [searchParams]);

	carried.current = carryRender(carried.current, query, selection);

	useEffect(() => {
		if (fromUrl) {
			storeSelection(selection);
			return;
		}

		if (isDefaultSelection(selection)) return;

		setSearchParams(
			prev => {
				const next = new URLSearchParams(prev);
				writeSelectionParams(next, selection);
				return next;
			},
			{replace: true},
		);
	}, [searchParams]);

	// Stored here as well as by the effect: putting everything back to the
	// defaults leaves the URL bare, and a bare URL reads the store — which
	// would otherwise still hold what was just undone.
	//
	// Replaced, not pushed: narrowing the board or paging the scrubber is not a
	// place to come back to, and the board's own routes stay the history.
	const change = useCallback(
		(patch: Partial<BoardSelection>) => {
			const next = applySelectionPatch(selection, patch);
			storeSelection(next);

			// Carried forward here rather than waiting for the render the new URL
			// causes: turning the last of these off empties the query, and a bare
			// query reads the carried values back — which, a beat before that
			// render, would still be the ones just switched off.
			carried.current = carryChange(carried.current, next);

			setSearchParams(
				prev => {
					const params = new URLSearchParams(prev);
					writeSelectionParams(params, next);
					return params;
				},
				{replace: true},
			);
		},
		[selection, setSearchParams],
	);

	return [selection, change];
};
