// The live mark: a dot with rings leaving it, the way a broadcast is drawn.
//
// Not the arrow a log row shows under the pointer — that one says "this line
// leads somewhere", which is true of a row and wrong for a mode. This says the
// board is riding the present.
//
// Unlit it is a ring around a hollow dot, so the mark keeps its size and its
// shape whether or not it is on. Lit, the dot fills and two rings leave it half
// a cycle apart — `epiqLiveRipple`, defined with the bar's own keyframes, so
// the animation is one declaration rather than one per instance.
export const IconLive = ({
	size = 14,
	lit = false,
}: {
	size?: number;
	lit?: boolean;
}) => (
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
		{lit ? (
			<>
				<circle cx="12" cy="12" r="9" className="epiq-live-ripple" />
				<circle
					cx="12"
					cy="12"
					r="9"
					className="epiq-live-ripple epiq-live-ripple--trailing"
				/>
			</>
		) : (
			<circle cx="12" cy="12" r="9" opacity={0.55} />
		)}

		<circle cx="12" cy="12" r="4" fill={lit ? 'currentColor' : 'none'} />
	</svg>
);
