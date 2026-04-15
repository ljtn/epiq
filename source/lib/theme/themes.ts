export const chalkColors = {
	// Base
	bg: '#1a1b26',
	fg: '#c0caf5',

	// Grays
	grayDark: '#2f344d',
	gray: '#565f89',
	grayLight: '#858999',

	// Accents
	cyan: '#7dcfff',
	cyanSoft: '#89ddff',

	blue: '#7aa2f7',

	magenta: '#be85d3',
	magentaSoft: '#c0a6ff',

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
