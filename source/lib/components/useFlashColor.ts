import {useEffect, useState} from 'react';
import {getGradientHexColor} from '../utils/color.js';

// Replay-touched nodes pulse through the progress bar's gradient on a shared
// wall-clock period, so all pulse in unison.
const FLASH_FRAME_MS = 80;
const FLASH_PERIOD_MS = 1400;

// One shared ticker for every flashing node.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

const subscribe = (fn: () => void): (() => void) => {
	listeners.add(fn);
	if (!timer) {
		timer = setInterval(() => {
			for (const listener of listeners) listener();
		}, FLASH_FRAME_MS);
	}

	return () => {
		listeners.delete(fn);
		if (listeners.size === 0 && timer) {
			clearInterval(timer);
			timer = null;
		}
	};
};

// Triangle wave in 0..1 derived from the wall clock, so the gradient sweeps out
// and back rather than snapping from cyan to lavender each cycle.
const flashPosition = (): number => {
	const phase = (Date.now() % FLASH_PERIOD_MS) / FLASH_PERIOD_MS;
	return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
};

// The current flash colour; only `active` callers re-render on the pulse.
export const useFlashColor = (active: boolean): string => {
	const [, force] = useState(0);

	useEffect(() => {
		if (!active) return;
		return subscribe(() => force(n => n + 1));
	}, [active]);

	return getGradientHexColor(flashPosition());
};
