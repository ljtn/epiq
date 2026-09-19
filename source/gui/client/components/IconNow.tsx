// The timeline's needle: a filled head over a dropped line, as the chart draws
// it. On the Now button it is the destination — the word sits at the left, this
// at the right, and the space the button puts between them is the run.
//
// The run was drawn in here once, as a chevron before the head. Two ideas in
// sixteen pixels left both of them thin, and the pair read as a smudge rather
// than as an arrow reaching a mark. One idea, drawn to fill the box.
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
