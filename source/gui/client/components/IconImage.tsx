// A framed picture: a hill and a sun inside a border. Stroked rather than
// filled, like IconBars and IconChevron, so it sits at the same weight as the
// other controls in a row.
export const IconImage = ({size = 16}: {size?: number}) => (
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
		<rect x="3" y="4.5" width="18" height="15" rx="2.5" />
		<circle cx="8.5" cy="10" r="1.6" />
		<path d="M4 16.5l4.5-4a1.6 1.6 0 0 1 2.2 0l4 3.6" />
		<path d="M14.5 13.5l1.8-1.6a1.6 1.6 0 0 1 2.2 0L20.5 13" />
	</svg>
);
