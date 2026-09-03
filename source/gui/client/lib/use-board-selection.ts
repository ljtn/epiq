import {useCallback, useEffect, useMemo, useRef} from 'react';
import {useSearchParams} from 'react-router-dom';
import {
	applySelectionPatch,
	BoardSelection,
	hasSelectionParams,
	isDefaultSelection,
	readSelectionParams,
	readStoredSelection,
	storeSelection,
	writeSelectionParams,
} from './board-selection';

// What a route change carries that neither the rebuilt query nor storage does.
type CarriedKey = 'offset' | 'zoom' | 'windowOnly';

// The URL wins when it says anything; a bare board link falls back to what
// was last used here, and gets that written into the address bar so copying
// it always hands over what is on screen. Either way storage follows the URL.
export const useBoardSelection = (): [
	BoardSelection,
	(patch: Partial<BoardSelection>) => void,
] => {
	const [searchParams, setSearchParams] = useSearchParams();

	const fromUrl = hasSelectionParams(searchParams);

	// The three storage does not keep, carried across the routes of this
	// session instead: opening a ticket rebuilds the query from scratch, and
	// none of a board narrowed to a window, a stretch dragged out of the chart,
	// or a window paged back off the present must come undone under the reader
	// who clicked one of the cards it left showing. A reload still starts wide,
	// unzoomed and at the present — where somebody is looking is a moment, not
	// a preference to restore.
	const carried = useRef<Pick<BoardSelection, CarriedKey>>({
		offset: 0,
		zoom: null,
		windowOnly: false,
	});

	const selection = useMemo(() => {
		const fromParams = readSelectionParams(searchParams);

		return fromParams ?? {...readStoredSelection(), ...carried.current};
	}, [searchParams]);

	carried.current = {
		offset: selection.offset,
		zoom: selection.zoom,
		windowOnly: selection.windowOnly,
	};

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
