// Sans for what is clicked and what people wrote. Inter, shipped with the GUI
// (see GlobalStyles), never fetched.
export const SANS_FONT =
	'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// Mono for what the board records, read in columns. Set again on anything
// drawn outside the app's tree, such as popovers portalled to the body.
export const MONO_FONT =
	'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// The side panel's text sizes. Prose (descriptions, comments, notes) sits a
// step above the mono UI text so the two fonts read at the same visual size.
export const TEXT = {
	label: 10,
	meta: 11,
	ui: 12,
	prose: 13,
	// The ticket's title: over the prose, under the band it sits beneath.
	title: 15,
} as const;

// Shared by prose and the fields that edit it, so an editor opens as the
// same text.
export const PROSE = {
	fontFamily: SANS_FONT,
	fontSize: TEXT.prose,
	lineHeight: '22px',
	letterSpacing: '0.2px',
} as const;

export const GUI_THEME = {
	bg: '#06070a',
	// The top bar, timeline and event log: below the board's own ground.
	chrome: '#000000',
	bgHighlight: '#10111a65',
	panel: '#11141b',
	panel2: '#151a24',
	// Between the page and a panel: what a panel made of cards stands on, so
	// the cards carry the lift and the ground stays back without going black.
	well: '#0d0f14',
	line: 'rgba(70, 87, 126, 0.15)',
	// The detail panel's outer edge, holding it apart from the board.
	edge: 'rgba(96, 116, 165, 0.55)',
	// The side panel's edge toward the board, quieter than `edge`.
	asideEdge: 'rgba(96, 116, 165, 0.25)',
	// `edge` over the black chrome, at half the alpha so it reads the same.
	edgeOnChrome: 'rgba(96, 116, 165, 0.28)',
	primary: '#c2c5d0',
	// One step under `primary`, for text repeated down a column, like card titles.
	primarySoft: '#aeb3c2',
	secondary: '#7f8aa3',
	tertiary: 'rgb(31 33 43)',
	// The chrome's quiet text: labels, unselected buttons, placeholders. A ladder
	// with `secondary`; lift them together.
	dim: '#6a7090',
	dim2: 'rgb(120 128 160)',
	// Under the ladder, for a log line's time and leading ref.
	faint: '#4e546c',
	// What anything under the pointer takes on: a lift, not a colour.
	hover: 'rgba(255,255,255,0.04)',
	// The confirming button in a row: `hover` a step further up.
	raised: 'rgba(255,255,255,0.055)',
	raisedHover: 'rgba(255,255,255,0.1)',
	accent: '#76d4ff',
	// The accent as a faint wash, for the one thing a link or follow points at.
	accentWash: 'rgba(118, 212, 255, 0.1)',
	// The accent as the edge of a selected card: the only accent it carries.
	accentEdge: 'rgba(118, 212, 255, 0.65)',
	green: '#8ce99a',
	// One step short of `red`, at the same pastel weight, for anything that
	// warns before it alarms.
	amber: '#ffc078',
	red: '#ff8787',
	transparent: 'rgba(0, 0, 0, 0)',
	// The dim over the page behind a modal.
	scrim: 'rgba(0, 0, 0, 0.5)',
};

// The Board series split by kind of change. Tickets keeps the accent; no
// green, which is the commit series.
export const EVENT_CATEGORY_COLORS = {
	tickets: GUI_THEME.accent,
	comments: '#ffd479',
	tagging: '#c9a5ff',
	assigning: '#ff9ecd',
} as const;

// The Contributors series: its own hue, since it plots what Board events do.
export const BOARD_CONTRIBUTOR_COLOR = '#7fd8c4';

export const getContrastTextColor = (backgroundColor: string): string => {
	const hex = backgroundColor.replace('#', '');

	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);

	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

	return luminance > 0.6 ? '#111111' : '#ffffff';
};
