// How history is paced when played back, shared by TUI and GUI.

// Each event's [0..1] position, gaps weighted by their square root so idle
// stretches compress; even spacing when timestamps tie.
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
