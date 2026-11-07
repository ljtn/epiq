import chalk from 'chalk';
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import {startGui} from './gui/init.js';
import EpiqApp from './lib/components/EpiqApp.js';
import {applyActorNameArgument} from './lib/config/actor-env.js';
import {failed, isFail, Result, succeeded} from './lib/model/result-types.js';
import {initUiState} from './lib/state/ux-state.js';
import {formatUnknownError} from './lib/utils/logger.utils.js';
import {EPIQ_VERSION} from './version.js';
import './logger.js';
import {bootTui} from './boot-tui.js';

initUiState();

const helpText = `${chalk.bold('Epiq CLI')}

${chalk.dim('Boot in directory:')}
  ${chalk.cyan('$ epiq')}

${chalk.dim('Launch GUI:')}
  ${chalk.cyan('$ epiq gui')}
  ${chalk.cyan('$ epiq gui --no-open')}  ${chalk.dim('no browser')}

${chalk.dim('Act as somebody other than the configured user:')}
  ${chalk.cyan('$ epiq --as claude')}
`;

const cli = meow(helpText, {
	importMeta: import.meta,
	version: EPIQ_VERSION,
	flags: {
		init: {
			type: 'boolean',
			default: false,
		},
		as: {
			type: 'string',
		},
		open: {
			type: 'boolean',
			default: true,
		},
	},
});

const command = cli.input[0];
if (command && command !== 'gui') {
	console.error(chalk.red(`Unknown command: ${command}`));
	process.exit(1);
}

// A flag rather than a positional, because `input[0]` is already the command.
if (cli.flags.as !== undefined) {
	const actor = applyActorNameArgument(cli.flags.as, '--as');

	if (isFail(actor)) {
		console.error(chalk.red(actor.message));
		process.exit(1);
	}
}

let width = process.stdout.columns || 120;
// A Windows console gets one row less: there Ink clears and redraws every
// frame that fills the terminal, which tears.
const appHeight = () =>
	Math.max(
		1,
		(process.stdout.rows || 20) - (process.platform === 'win32' ? 1 : 0),
	);

let height = appHeight();
let ink: ReturnType<typeof render> | null = null;

const renderNode = (node: React.ReactNode): Result<void> => {
	try {
		if (!ink) {
			ink = render(node, {incrementalRendering: true});
			return succeeded('Rendered app', undefined);
		}

		ink.rerender(node);
		return succeeded('Rerendered app', undefined);
	} catch (error) {
		return failed(`Unable to render app: ${formatUnknownError(error)}`);
	}
};

export const renderApp = (): Result<void> =>
	renderNode(<EpiqApp width={width} height={height} />);

process.stdout.on('resize', () => {
	width = process.stdout.columns || 120;
	height = appHeight();

	if (!ink) return;

	const renderResult = renderApp();

	if (isFail(renderResult)) {
		logger.info(`[boot:resize] ${renderResult.message}`);
	}
});

if (command === 'gui') {
	const guiResult = await startGui({
		repoRoot: process.cwd(),
		open: cli.flags.open,
	});

	if (isFail(guiResult)) {
		console.error(chalk.red(`Failed to start Epiq GUI:\n${guiResult.message}`));
		process.exitCode = 1;
	}
} else {
	// Raw before the screen is cleared: a key typed in cooked mode is echoed by
	// the terminal itself, and the echo moves the cursor under Ink's diff.
	if (process.stdin.isTTY) process.stdin.setRawMode(true);
	console.clear();

	const bootResult = await bootTui();

	if (isFail(bootResult)) {
		logger.info(bootResult.message);
		console.error(chalk.red(`Failed to boot Epiq:\n${bootResult.message}`));
		process.exitCode = 1;
	}
}
