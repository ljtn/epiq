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

// The URL wins when it says anything; a bare link falls back to storage and
// writes it into the address bar. Storage follows the URL.
export const useBoardSelection = (): [
	BoardSelection,
	(patch: Partial<BoardSelection>) => void,
] => {
	const [searchParams, setSearchParams] = useSearchParams();

	const fromUrl = hasSelectionParams(searchParams);

	// What storage does not keep, carried across this session's routes, including
	// the ticket narrowing.
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

	// Stored here too, since resetting leaves a bare URL that reads the store.
	// Replaced, not pushed: narrowing is not a place to come back to.
	const change = useCallback(
		(patch: Partial<BoardSelection>) => {
			const next = applySelectionPatch(selection, patch);
			storeSelection(next);

			// Carried now, not on the next render, which would read the old values back.
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
