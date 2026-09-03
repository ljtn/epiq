// UI chrome (labels, buttons, tags) stays monospace to match the rest of the
// app; prose content (description, title, comments) uses this for readability.
export const CONTENT_FONT =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

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
	bgHighlight: '#10111a65',
	panel: '#11141b',
	panel2: '#151a24',
	line: 'rgba(70, 87, 126, 0.15)',
	// The detail panel's own outer edge. `line` divides sections inside one
	// surface; this one has to hold the panel apart from the board behind it,
	// which takes considerably more contrast.
	edge: 'rgba(96, 116, 165, 0.55)',
	primary: '#c2c5d0',
	secondary: '#7f8aa3',
	tertiary: 'rgb(31 33 43)',
	dim: '#585d78',
	dim2: 'rgb(100 107 133)',
	// What anything the pointer is over takes on, throughout: buttons, rows,
	// menu items. A lift off whatever it sits on rather than a colour of its
	// own, so it reads the same on the panel as on the board.
	hover: 'rgba(255,255,255,0.04)',
	accent: '#76d4ff',
	green: '#8ce99a',
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

export const getContrastTextColor = (backgroundColor: string): string => {
	const hex = backgroundColor.replace('#', '');

	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);

	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

	return luminance > 0.6 ? '#111111' : '#ffffff';
};
