// The live mark: a dot with rings leaving it. Unlit, a ring round a hollow dot
// at the same size; lit, it ripples via the shared `epiqLiveRipple` keyframes.
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
