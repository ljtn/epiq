// The live mark: a filled dot inside a ring, the convention a broadcast wears.
//
// Not the arrow a log row shows under the pointer — that one says "this line
// leads somewhere", which is true of a row and wrong for a mode. This says the
// board is riding the present.
//
// The ring is drawn whether or not it is lit; the dot is what fills. So the
// mark keeps its size in the row and the difference between watching and not
// is a fill rather than a shape.
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
		<circle cx="12" cy="12" r="9" opacity={lit ? 0.9 : 0.55} />
		<circle cx="12" cy="12" r="4" fill={lit ? 'currentColor' : 'none'} />
	</svg>
);
