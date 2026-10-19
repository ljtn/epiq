import {RefObject, useLayoutEffect} from 'react';

// Tall enough for a long text, short enough to keep what is around it in view.
export const AUTO_GROW_MAX_HEIGHT = 480;

// A textarea as tall as its text, so a long one is written without hunting
// for the resize handle. Past `maxHeight` it scrolls instead.
export const useAutoGrow = (
	ref: RefObject<HTMLTextAreaElement | null>,
	value: string,
	{active = true, maxHeight}: {active?: boolean; maxHeight?: number} = {},
) => {
	useLayoutEffect(() => {
		const el = ref.current;
		if (!active || !el) return;

		el.style.height = 'auto';
		const content = el.scrollHeight;
		// A hidden box measures nothing, so it keeps its natural height.
		if (content === 0) return;

		const capped = maxHeight !== undefined && content > maxHeight;
		el.style.height = `${capped ? maxHeight : content}px`;
		el.style.overflowY = capped ? 'auto' : 'hidden';
	}, [ref, value, active, maxHeight]);
};
