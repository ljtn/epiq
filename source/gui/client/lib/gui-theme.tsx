// UI chrome (labels, buttons, tags) stays monospace to match the rest of the
// app; prose content (description, title, comments) uses this for readability.
export const CONTENT_FONT =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

// The chrome's own face. Set once on the tree the app draws into, and again by
// anything drawn outside it: a window of its own, the screen shown before there
// is a board, and any popover portalled to the body, which inherits from there
// rather than from the control it belongs to.
export const UI_FONT =
	'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// The side panel's text sizes. Prose (descriptions, comments, notes) sits a
// step above the mono UI text so the two fonts read at the same visual size.
export const TEXT = {
	label: 10,
	meta: 11,
	ui: 12,
	prose: 13,
	title: 18,
} as const;

export const GUI_THEME = {
	bg: '#06070a',
	// The instrumentation around the work: the top bar, the timeline and the
	// event log. Below the board's own ground rather than above it, so the
	// chrome reads as the room and the board as what is lit in it.
	chrome: '#000000',
	bgHighlight: '#10111a65',
	panel: '#11141b',
	panel2: '#151a24',
	line: 'rgba(70, 87, 126, 0.15)',
	// The detail panel's own outer edge. `line` divides sections inside one
	// surface; this one has to hold the panel apart from the board behind it,
	// which takes considerably more contrast.
	edge: 'rgba(96, 116, 165, 0.55)',
	// The same edge over the chrome's ground rather than the panel's. That
	// ground is black, so a translucent line lands on more contrast there and
	// reads brighter at the same value — half the alpha is what makes the two
	// look like one edge drawn twice.
	edgeOnChrome: 'rgba(96, 116, 165, 0.28)',
	primary: '#c2c5d0',
	// One step under `primary`, for text that is the content of what it sits in
	// but repeats all the way down a column — a card's title. Thirty of those at
	// full `primary` is the brightest thing on the board, louder than the accent
	// marking the selected card, and it leaves the ref and the tags nothing to
	// stand against. Still well clear of a reading contrast: what comes off is
	// the shout, not the legibility.
	primarySoft: '#aeb3c2',
	// `primary`'s brightness with a hint of the blue the bright text around it
	// carries — `primarySoft`'s tint, not the dim chrome's, which at this
	// weight would read as a blue label rather than as a name.
	chromePrimary: '#c0c5d4',
	secondary: '#7f8aa3',
	tertiary: 'rgb(31 33 43)',
	dim: '#585d78',
	dim2: 'rgb(100 107 133)',
	// What anything the pointer is over takes on, throughout: buttons, rows,
	// menu items. A lift off whatever it sits on rather than a colour of its
	// own, so it reads the same on the panel as on the board.
	hover: 'rgba(255,255,255,0.04)',
	// What the confirming button in a row is filled with — `hover` a step
	// further up, and a wash rather than a colour for the same reason: it sits
	// on the panel, on a modal and inside the diff's own composer, whose ground
	// is the flat colour this used to be painted in.
	raised: 'rgba(255,255,255,0.055)',
	raisedHover: 'rgba(255,255,255,0.1)',
	accent: '#76d4ff',
	// The accent laid over whatever is underneath, for the one thing a link or
	// a follow is pointing at: the log's followed line, the comment a log line
	// leads to. Faint on purpose — it says "this one", not "look here".
	accentWash: 'rgba(118, 212, 255, 0.1)',
	green: '#8ce99a',
	// One step short of `red`, at the same pastel weight, for anything that
	// warns before it alarms.
	amber: '#ffc078',
	red: '#ff8787',
	transparent: 'rgba(0, 0, 0, 0)',
};

// The Board series split by what kind of change each event was. Tickets keeps
// the accent, being both the bulk of the log and what "Board" meant before the
// split; the rest are spaced around the wheel at a matching lightness. Green is
// avoided throughout — that is the commit series.
export const EVENT_CATEGORY_COLORS = {
	tickets: GUI_THEME.accent,
	comments: '#ffd479',
	tagging: '#c9a5ff',
	assigning: '#ff9ecd',
} as const;

// The Contributors series, which is not a kind of event but a way of splitting
// every kind. Its own hue rather than the Board accent: it plots what "Board
// events" plots, so sharing a colour would leave the two rows saying the same
// thing.
export const BOARD_CONTRIBUTOR_COLOR = '#7fd8c4';

export const getContrastTextColor = (backgroundColor: string): string => {
	const hex = backgroundColor.replace('#', '');

	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);

	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

	return luminance > 0.6 ? '#111111' : '#ffffff';
};
