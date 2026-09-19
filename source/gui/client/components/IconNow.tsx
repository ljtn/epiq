// The way back from history: a run to the end of the track, where the needle
// stands.
//
// The end is drawn as the needle itself — the chart's own mark, a head over a
// dropped line — rather than as a plain bar. A bar says "the end of something";
// the needle says which thing, and it is the one the press actually moves.
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
		<path d="M2 12h8" />
		<path d="m7 8.5 3.5 3.5L7 15.5" />
		{/* The needle: a filled head over its line, as the chart draws it. */}
		<path d="M14.5 4h8l-4 5z" fill="currentColor" stroke="none" />
		<path d="M18.5 9v11" />
	</svg>
);
