// A hand-held torch, angled down at the timeline the bar sits over: a
// rounded body with its switch, a break, then the head, a cone widening into
// a short cylinder — drawn light so it stays open at the size the bar draws
// it. Lit, three rays fan out ahead of the lens, clear of it: on is light,
// not only a colour.
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
		strokeWidth="1.5"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<g transform="rotate(45 12 12)">
			<path d="M4.5 9.5h6v5h-6a2.5 2.5 0 0 1 0-5z" />
			<path d="M6.5 12h1" />
			{/* A cone that widens into a short cylinder, not a cone alone. */}
			<path d="M11.5 9.5 14 7.5h2.5v9H14l-2.5-2z" />
			{lit && (
				<>
					<path d="M19.5 12h2.5" />
					<path d="m18.5 8.5 2-2" />
					<path d="m18.5 15.5 2 2" />
				</>
			)}
		</g>
	</svg>
);
