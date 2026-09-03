// Lines of log: a dot and a run of text, three times over, ragged at the right
// the way a column of entries is. The dots are zero-length strokes with a round
// cap, which is what the panel's own rows are marked with.
export const IconLog = ({size = 14}: {size?: number}) => (
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
		<line x1="4" y1="6" x2="4.01" y2="6" />
		<line x1="9" y1="6" x2="20" y2="6" />
		<line x1="4" y1="12" x2="4.01" y2="12" />
		<line x1="9" y1="12" x2="16" y2="12" />
		<line x1="4" y1="18" x2="4.01" y2="18" />
		<line x1="9" y1="18" x2="19" y2="18" />
	</svg>
);
