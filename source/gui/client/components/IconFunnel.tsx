// A funnel: the filter mark, as devtools and spreadsheets draw it — a wide
// mouth narrowing to a stem, which is the shape of taking a lot and letting a
// little through.
//
// Worn by both of the board's narrowings — to a ticket, in the ticket panel,
// and to the timeline's window, on the scrubber bar. One mark for one meaning:
// they are never on the same row, and the window one goes flat while the
// ticket one is on, so the two can never claim to narrow at once.
export const IconFunnel = ({size = 14}: {size?: number}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M4 6h16l-6 7v7l-4-2.5V13z" />
	</svg>
);
