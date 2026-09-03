// How a stretch of history is paced when it is played back as a movie. Shared
// by the TUI's replay engine and the GUI's theatre player so a board's history
// runs at the same tempo whichever one is watching it.

// Build the normalized [0..1] position at which each event should have played.
// Inter-event gaps are weighted by their square root so long idle stretches
// compress (a month-long gap costs far less than 30 day-long ones) while bursts
// of rapid edits keep their relative spacing — quiet periods fast-forward,
// crunch weeks burst. Falls back to even spacing when timestamps are identical.
export const buildPlaybackFractions = (times: number[]): number[] => {
	const cumulative: number[] = [];
	let acc = 0;

	for (let i = 0; i < times.length; i++) {
		const gap = i === 0 ? 0 : Math.max(0, times[i]! - times[i - 1]!);
		acc += Math.sqrt(gap);
		cumulative[i] = acc;
	}

	const total = acc;

	return cumulative.map((value, i) =>
		total > 0 ? value / total : (i + 1) / times.length,
	);
};
