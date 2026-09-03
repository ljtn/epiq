// A timeline: an axis with graduations under it, the middle one longer, the way
// a ruler marks its scale. Dots on a line read as one thick line at this size,
// and bars over one are what IconBars already means on this same row.
export const IconTimeline = ({size = 14}: {size?: number}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2"
		strokeLinecap="round"
		aria-hidden="true"
	>
		<line x1="3" y1="8" x2="21" y2="8" />
		<line x1="7" y1="8" x2="7" y2="13" />
		<line x1="12" y1="8" x2="12" y2="17" />
		<line x1="17" y1="8" x2="17" y2="13" />
	</svg>
);
