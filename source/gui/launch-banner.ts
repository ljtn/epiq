import os from 'node:os';
import path from 'node:path';
import chalk from 'chalk';
import {WORDMARK_LINES} from '../lib/static/wordmark.js';
import {theme} from '../lib/theme/themes.js';
import {getGradientColor} from '../lib/utils/color.js';

const INDENT = '  ';

const label = chalk.hex(theme.secondary2);
const quiet = chalk.hex(theme.gray);

// Diagonal, so each row starts a little further along the gradient than the one
// above and the letters read as lit from one corner rather than striped.
const paintWordmark = (): string[] => {
	const width = WORDMARK_LINES[0].length;
	const span = width + WORDMARK_LINES.length * 2;

	return WORDMARK_LINES.map((line, row) =>
		Array.from(line)
			.map((char, col) => {
				const [r, g, b] = getGradientColor((col + row * 2) / span);
				return chalk.rgb(r, g, b)(char);
			})
			.join(''),
	);
};

const tildify = (dir: string): string => {
	const home = os.homedir();
	return dir === home || dir.startsWith(home + path.sep)
		? '~' + dir.slice(home.length)
		: dir;
};

const row = (name: string, value: string) =>
	`${INDENT}${chalk.hex(theme.accent)('➜')}  ${label(name.padEnd(9))}${value}`;

export const launchBanner = ({
	url,
	repoRoot,
	version,
	reused,
}: {
	url: string;
	repoRoot: string;
	version: string;
	reused: boolean;
}): string =>
	[
		'',
		...paintWordmark().map(line => INDENT + line),
		'',
		`${INDENT}${label('gui')} ${quiet(`· v${version}`)}`,
		'',
		row('Local', chalk.hex(theme.accent).bold(url)),
		row('Project', tildify(repoRoot)),
		'',
		INDENT +
			quiet(
				reused
					? 'already running for this project · opened in your browser'
					: 'press ctrl+c to stop',
			),
		'',
	].join('\n');
