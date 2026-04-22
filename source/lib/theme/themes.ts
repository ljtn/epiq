import {getState} from '../state/state.js';

export const colors = {
	// Base (keep — already perfect for midnight themes)
	bg: '#1a1b26',
	fg: '#c8d3ff', // slightly lifted toward your gradient

	// Grays (cooler + slightly more blue)
	grayDark: '#2a2f45',
	gray: '#46507a',
	grayLight: '#969bb5',

	// Accents — now derived from your gradient

	// Cyan edge (softer + slightly less green)
	cyan: '#88d5ee',
	cyanSoft: '#8fe6fb',

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
	accent: colors.cyan,
	accent2: colors.magenta,
	primary: colors.white,
	secondary: colors.grayDark,
	secondary2: colors.grayLight,
	gray: colors.gray,
	green: colors.green,
	yellow: colors.yellow,
	red: colors.red,
};
