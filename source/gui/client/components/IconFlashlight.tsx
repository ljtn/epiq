// A hand-held torch, angled down at the timeline the bar sits over: a
// rounded body with its switch, a break, then the head, a cone widening into
// a short cylinder. Lit, three rays fan out ahead of the lens, clear of it: on
// is light, not only a colour.
//
// Drawn on the diagonal, which costs it size against the upright glyphs beside
// it: it fills its box out to the rays and carries their stroke, or it reads as
// the faintest thing on the bar.
export const IconFlashlight = ({
	size = 16,
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
		<g transform="rotate(45 12 12)">
			<path d="M2.6 8.9h7.5v6.2H2.6a3.1 3.1 0 0 1 0-6.2z" />
			<path d="M5.1 12h1.3" />
			{/* A cone that widens into a short cylinder, not a cone alone. */}
			<path d="M11.4 8.9 14.5 6.4h3.1v11.2H14.5l-3.1-2.5z" />
			{lit && (
				<>
					<path d="M20.2 12h2.2" />
					<path d="m19.3 8.2 1.6-1.6" />
					<path d="m19.3 15.8 1.6 1.6" />
				</>
			)}
		</g>
	</svg>
);
