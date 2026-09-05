import {useEffect, useMemo, useRef, useState} from 'react';

// Gated in JS rather than by a stylesheet media query because the animations it
// guards are inline styles, which a stylesheet can only beat with !important.
// Below this the controls row runs out of room for seven scope buttons beside
// everything else on it, and the end of the row — where the transport is — is
// the first thing squeezed. Measured against the row's own content rather than
// a device class: it is the bar that is narrow, not the phone.
const NARROW_BAR_QUERY = '(max-width: 1180px)';

export const useNarrowBar = (): boolean => {
	const [narrow, setNarrow] = useState(
		() => window.matchMedia(NARROW_BAR_QUERY).matches,
	);

	useEffect(() => {
		const query = window.matchMedia(NARROW_BAR_QUERY);
		const onChange = () => setNarrow(query.matches);

		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	}, []);

	return narrow;
};

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export const usePrefersReducedMotion = (): boolean => {
	const [reduced, setReduced] = useState(
		() => window.matchMedia(REDUCED_MOTION_QUERY).matches,
	);

	useEffect(() => {
		const query = window.matchMedia(REDUCED_MOTION_QUERY);
		const onChange = () => setReduced(query.matches);

		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	}, []);

	return reduced;
};

export type SeriesPresence = {mounted: boolean; leaving: boolean};

// Unticking a series has to outlive the render that hid it, or its dots vanish
// instead of retracting. `durationMs` of 0 skips the wait entirely, which is
// how reduced motion and the bar charts opt out.
export const useExitTransition = (
	visible: boolean,
	durationMs: number,
): SeriesPresence => {
	const [mounted, setMounted] = useState(visible);
	const [leaving, setLeaving] = useState(false);
	// Compared against, rather than depended on: the effect must run only when
	// the flag actually flips, so a series hidden on first paint never plays an
	// exit it was never visible for.
	const wasVisible = useRef(visible);
	// Read through a ref so a duration change cannot re-run the effect. It
	// would clear the running timeout, hit the guard above, and never reschedule
	// — stranding the series mounted and invisible.
	const duration = useRef(durationMs);
	duration.current = durationMs;

	useEffect(() => {
		if (visible === wasVisible.current) return;
		wasVisible.current = visible;

		if (visible) {
			setLeaving(false);
			setMounted(true);
			return;
		}

		if (duration.current === 0) {
			setMounted(false);
			return;
		}

		setLeaving(true);

		const timeout = setTimeout(() => {
			setLeaving(false);
			setMounted(false);
		}, duration.current);

		// Re-ticking mid-exit cancels it, so the dots never finish leaving.
		return () => clearTimeout(timeout);
	}, [visible]);

	// Stable identity: the memos that hang off this feed the scatter canvas,
	// which repaints every dot when its layers change.
	return useMemo(() => ({mounted, leaving}), [mounted, leaving]);
};

// Only an explicit stored value overrides the fallback, so a series that
// defaults to on stays on until somebody turns it off.
export const usePersistedFlag = (
	key: string,
	fallback: boolean,
): [boolean, (next: boolean) => void] => {
	const [value, setValue] = useState(() => {
		const stored = localStorage.getItem(key);
		return stored === null ? fallback : stored === 'true';
	});

	return [
		value,
		(next: boolean) => {
			setValue(next);
			localStorage.setItem(key, String(next));
		},
	];
};

// ---------------------------------------------------------------- board filter
