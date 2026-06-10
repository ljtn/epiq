export const GUI_THEME = {
	bg: '#090a0f',
	panel: '#11141b',
	panel2: '#151a24',
	line: 'rgba(67, 74, 89, 0.2)',
	primary: '#c2c5d0',
	secondary: '#7f8aa3',
	dim: '#5e667a',
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
