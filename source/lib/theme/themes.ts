export const chalkColors = {
	// Base (keep — already perfect for midnight themes)
	bg: '#1a1b26',
	fg: '#c8d3ff', // slightly lifted toward your gradient

	// Grays (cooler + slightly more blue)
	grayDark: '#2a2f45',
	gray: '#46507a',
	grayLight: '#9ea2b6',

	// Accents — now derived from your gradient

	// Cyan edge (softer + slightly less green)
	cyan: '#6ee7f0',
	cyanSoft: '#9ff1f7',

	// Blue core (closer to your [59,130,246])
	blue: '#5b8cff',

	// Lavender instead of purple (matches [168,139,250])
	magenta: '#a78bfa',
	magentaSoft: '#c4b5fd',

	// Semantic (nudged to fit the cooler palette)
	green: '#8fdc8c',
	yellow: '#f1c27d',
	red: '#ff7a90',

	white: '#ffffff',
} as const;

export const theme = {
	accent: chalkColors.cyan,
	accent2: chalkColors.magenta,
	primary: chalkColors.white,
	secondary: chalkColors.grayDark,
	secondary2: chalkColors.grayLight,
};
