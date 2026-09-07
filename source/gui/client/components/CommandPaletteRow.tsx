import {GUI_THEME, TEXT} from '../lib/gui-theme';

// The characters the query hit, marked in place. Ranges rather than one span
// per character, so a run of matched letters underlines as one.
const Highlighted = ({text, hits}: {text: string; hits: number[]}) => {
	if (hits.length === 0) return <>{text}</>;

	const marked = new Set(hits);

	return (
		<>
			{[...text].map((character, index) =>
				marked.has(index) ? (
					<span key={index} style={{color: GUI_THEME.accent}}>
						{character}
					</span>
				) : (
					<span key={index}>{character}</span>
				),
			)}
		</>
	);
};

export const CommandPaletteRow = ({
	title,
	hits,
	group,
	reason,
	hint,
	color,
	selected,
	hasArguments,
	onHover,
	onRun,
}: {
	title: string;
	hits: number[];
	// The section this belongs to, shown right-aligned rather than as a header:
	// the list reorders as you type, and headers over a moving list flicker.
	group?: string;
	// Why it cannot run; the row dims and says so instead of disappearing.
	reason?: string | null;
	hint?: string;
	color?: string;
	selected: boolean;
	hasArguments?: boolean;
	onHover: () => void;
	onRun: () => void;
}) => (
	<button
		type="button"
		role="option"
		aria-selected={selected}
		aria-disabled={Boolean(reason)}
		title={reason ?? undefined}
		onMouseMove={onHover}
		onClick={onRun}
		style={{
			display: 'flex',
			alignItems: 'center',
			gap: 8,
			width: '100%',
			textAlign: 'left',
			background: selected ? GUI_THEME.hover : 'transparent',
			border: 'none',
			borderLeft: `2px solid ${selected ? GUI_THEME.accent : 'transparent'}`,
			color: reason ? GUI_THEME.dim : GUI_THEME.primary,
			fontSize: TEXT.ui,
			fontFamily: 'inherit',
			padding: '7px 12px',
			cursor: reason ? 'default' : 'pointer',
		}}
	>
		{color && (
			<span
				aria-hidden
				style={{
					width: 7,
					height: 7,
					borderRadius: 2,
					background: color,
					flexShrink: 0,
					opacity: reason ? 0.4 : 1,
				}}
			/>
		)}

		<span
			style={{
				flex: 1,
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
			}}
		>
			<Highlighted text={title} hits={hits} />
			{hasArguments && <span style={{color: GUI_THEME.dim}}> …</span>}
		</span>

		{/* The reason outranks the group: on a row that cannot run, what it
		    belongs to is not what the reader needs to know. */}
		<span
			style={{
				fontSize: TEXT.label,
				color: GUI_THEME.dim,
				flexShrink: 0,
				whiteSpace: 'nowrap',
			}}
		>
			{reason ?? hint ?? group}
		</span>
	</button>
);
