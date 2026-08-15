export const IconLock = ({size = 13}: {size?: number}) => (
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
		<rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
		<path d="M7 11V7a5 5 0 0 1 10 0v4" />
		{/* Without the keyhole the shackle and body read as a head and shoulders.
		    Filled rather than stroked: at 13px a stroked keyhole collapses into
		    the 2px body weight. */}
		<circle cx="12" cy="16.5" r="2.1" fill="currentColor" stroke="none" />
	</svg>
);
