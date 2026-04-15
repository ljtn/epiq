export const chalkColors = {
	// Base
	bg: '#1a1b26',
	fg: '#c0caf5',

	// Grays (cool, blue-leaning, evenly spaced)
	grayDark: '#2f344d',
	gray: '#4c567a',
	grayLight: '#7f8bb3',

	// Accents (slightly shifted toward blue)
	cyan: '#7dcfff',
	cyanSoft: '#89ddff',

	blue: '#7aa2f7',

	// Less purple, more blue-violet
	magenta: '#9d7cd8',
	magentaSoft: '#a890e8',

	// Semantic
	green: '#9ece6a',
	yellow: '#e0af68',
	red: '#f7768e',

	white: '#ffffff',
} as const;

export const theme = {
	accent: chalkColors.cyan,
	accent2: chalkColors.magenta,
	primary: chalkColors.white,
	secondary: chalkColors.grayDark,
	secondary2: chalkColors.grayLight,
};
