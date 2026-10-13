// A chain with a break in it: a link let go of, where a bin would read as
// destroying the thing linked.
export const IconUnlink = ({size = 14}: {size?: number}) => (
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
		<path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
		<path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71" />
		<line x1="8" y1="2" x2="8" y2="5" />
		<line x1="2" y1="8" x2="5" y2="8" />
		<line x1="16" y1="19" x2="16" y2="22" />
		<line x1="19" y1="16" x2="22" y2="16" />
	</svg>
);
