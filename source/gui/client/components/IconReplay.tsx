// Replay: a play triangle inside an arrow that comes back round to where it
// started. Next to the live mark, "play" alone would read as the opposite of
// pause rather than as the opposite of live — this one says the board is about
// to walk through what already happened.
export const IconReplay = ({size = 14}: {size?: number}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.8"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		{/* Open at the top right, where the arrow head lands, so the ring reads
		    as a loop being closed rather than as a circle with a nick in it. */}
		<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
		<path d="M19.6 2.9v3.6h-3.6" />
		{/* Solid, so the mark at this size is a shape rather than three strokes
		    that merge into the ring around them. */}
		<path d="M10.4 8.8 15.2 12l-4.8 3.2z" fill="currentColor" />
	</svg>
);
