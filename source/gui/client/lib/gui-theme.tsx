// UI chrome (labels, buttons, tags) stays monospace to match the rest of the
// app; prose content (description, title, comments) uses this for readability.
export const CONTENT_FONT =
	'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

export const GUI_THEME = {
	bg: '#06070a',
	bgHighlight: '#10111a65',
	panel: '#11141b',
	panel2: '#151a24',
	line: 'rgba(70, 87, 126, 0.15)',
	primary: '#c2c5d0',
	secondary: '#7f8aa3',
	tertiary: 'rgb(31 33 43)',
	dim: '#585d78',
	dim2: 'rgb(100 107 133)',
	accent: '#76d4ff',
	green: '#8ce99a',
	red: '#ff8787',
};

export const getContrastTextColor = (backgroundColor: string): string => {
	const hex = backgroundColor.replace('#', '');

	const r = Number.parseInt(hex.slice(0, 2), 16);
	const g = Number.parseInt(hex.slice(2, 4), 16);
	const b = Number.parseInt(hex.slice(4, 6), 16);

	const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

	return luminance > 0.6 ? '#111111' : '#ffffff';
};
