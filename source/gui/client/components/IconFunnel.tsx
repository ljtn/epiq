// A funnel: the filter mark, as devtools and spreadsheets draw it — a wide
// mouth narrowing to a stem, which is the shape of taking a lot and letting a
// little through.
//
// Not IconTimeline, which this used to wear: that one says "the timeline" on
// the scrubber's own bar, and a mark cannot mean the thing and a filter over
// the thing on one screen.
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
