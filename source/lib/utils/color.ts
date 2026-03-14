const stringHash = (value: string): number => {
	let hash = 0;

	for (let i = 0; i < value.length; i++) {
		hash = value.charCodeAt(i) + ((hash << 5) - hash);
		hash |= 0;
	}

	return Math.abs(hash);
};

const hslToHex = (h: number, s: number, l: number): string => {
	s /= 100;
	l /= 100;

	const c = (1 - Math.abs(2 * l - 1)) * s;
	const hh = h / 60;
	const x = c * (1 - Math.abs((hh % 2) - 1));

	let r = 0;
	let g = 0;
	let b = 0;

	if (hh >= 0 && hh < 1) {
		r = c;
		g = x;
	} else if (hh >= 1 && hh < 2) {
		r = x;
		g = c;
	} else if (hh >= 2 && hh < 3) {
		g = c;
		b = x;
	} else if (hh >= 3 && hh < 4) {
		g = x;
		b = c;
	} else if (hh >= 4 && hh < 5) {
		r = x;
		b = c;
	} else {
		r = c;
		b = x;
	}

	const m = l - c / 2;
	const toHex = (value: number): string =>
		Math.round((value + m) * 255)
			.toString(16)
			.padStart(2, '0');

	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const stringToHslHexColor = (value: string): string => {
	const hash = stringHash(value);

	const hue = hash % 360;
	const saturation = 65;
	const lightness = 45;

	return hslToHex(hue, saturation, lightness);
};
