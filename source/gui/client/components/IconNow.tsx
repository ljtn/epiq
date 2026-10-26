// The timeline's needle: a filled head over a dropped line, as the chart draws it.
export const IconNow = ({size = 16}: {size?: number}) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		strokeWidth="2.6"
		strokeLinecap="round"
		strokeLinejoin="round"
		aria-hidden="true"
	>
		<path d="M3 3h18l-9 10z" fill="currentColor" stroke="none" />
		<path d="M12 13v8" />
	</svg>
);
