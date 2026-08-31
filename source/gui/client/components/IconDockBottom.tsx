// A pane attached to the bottom edge, the way devtools draws its dock choices:
// the frame, and one divider showing where the panel sits. Two marks only —
// anything finer closes up at the 12px these render at.
export const IconDockBottom = ({size = 16}: {size?: number}) => (
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
		<rect x="3" y="4" width="18" height="16" rx="2" />
		<line x1="3" y1="14" x2="21" y2="14" />
	</svg>
);
