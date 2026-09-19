// The way back from history: an arrow running to the end of the track, which is
// where now is.
//
// Drawn as "skip to the end" rather than as the timeline's needle at rest. It
// sits in the transport, where every other mark says what pressing it does —
// play walks the past, live rides the present — and an arrow is an action where
// a needle is a position. The end bar is the needle's home either way.
export const IconNow = ({size = 14}: {size?: number}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.9"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		{/* The run up to it, stopping short so the head is not swallowed. */}
		<path d="M3 12h11" />
		<path d="m10.5 7.5 4.5 4.5-4.5 4.5" />
		{/* The end of the track, standing where the needle would. */}
		<path d="M20 5.5v13" />
	</svg>
);
