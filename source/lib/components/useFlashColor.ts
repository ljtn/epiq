import {useEffect, useState} from 'react';
import {getGradientHexColor} from '../utils/color.js';

// Nodes touched by the current replay frame pulse through the same
// lavender -> blue -> cyan gradient as the progress bar, instead of sitting on a
// flat yellow. The position ping-pongs across the gradient on a fixed wall-clock
// period so the highlight reads as a soft flash and every flashing node pulses in
// unison regardless of when it started flashing.
const FLASH_FRAME_MS = 80;
const FLASH_PERIOD_MS = 1400;

// One shared ticker drives every flashing node so they stay in sync and we don't
// spin up a timer per ticket on the board — flashing components just subscribe to
// the re-render pulse and read the wall-clock color.
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

// Returns the current gradient flash color. Pass `active` so only nodes that are
// actually flashing subscribe to the ticker; inactive callers get a color too
// (cheap), they just won't re-render on the pulse.
export const useFlashColor = (active: boolean): string => {
	const [, force] = useState(0);

	useEffect(() => {
		if (!active) return;
		return subscribe(() => force(n => n + 1));
	}, [active]);

	return getGradientHexColor(flashPosition());
};
