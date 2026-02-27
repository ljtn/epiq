export const colors = {
	black: 'black',
	red: 'red',
	green: 'green',
	yellow: 'yellow',
	blue: 'blue',
	cyan: 'cyan',
	magenta: 'magenta',
	white: 'white',
	gray: 'gray',
	grey: 'grey',
	blackBright: 'blackBright',
	redBright: 'redBright',
	greenBright: 'greenBright',
	yellowBright: 'yellowBright',
	blueBright: 'blueBright',
	cyanBright: 'cyanBright',
	magentaBright: 'magentaBright',
	whiteBright: 'whiteBright',
} as const;

export const chalkColors = {
	cyan: '#7DCFFF',
	cyanSoft: '#89DDFF',
	gray: '#C0CAF5',
	grayLight: '#9AA5CE',
	grayDark: '#565F89',
} as const;

export const theme = {
	accent: colors.cyan,
	accent2: colors.magenta,
	primary: colors.white,
	secondary: colors.gray,
};
