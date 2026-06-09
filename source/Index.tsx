import chalk from 'chalk';
import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import {startGui} from './gui/init.js';
import EpiqApp from './lib/components/EpiqApp.js';
import {failed, isFail, Result, succeeded} from './lib/model/result-types.js';
import {initUiState} from './lib/state/ux-state.js';
import {formatUnknownError} from './lib/utils/logger.utils.js';
import './logger.js';
import {bootTui} from './boot-tui.js';

initUiState();

const helpText = `${chalk.bold('Epiq CLI')}

${chalk.dim('Boot in directory:')}
  ${chalk.cyan('$ epiq')}

${chalk.dim('Launch GUI:')}
  ${chalk.cyan('$ epiq gui')}
`;

const cli = meow(helpText, {
	importMeta: import.meta,
	flags: {
		init: {
			type: 'boolean',
			default: false,
		},
	},
});

const command = cli.input[0];
if (command && command !== 'gui') {
	console.error(chalk.red(`Unknown command: ${command}`));
	process.exit(1);
}

let width = process.stdout.columns || 120;
let height = process.stdout.rows || 20;
let ink: ReturnType<typeof render> | null = null;

const renderNode = (node: React.ReactNode): Result<void> => {
	try {
		if (!ink) {
			ink = render(node);
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
	height = process.stdout.rows || 20;

	if (!ink) return;

	const renderResult = renderApp();

	if (isFail(renderResult)) {
		logger.info(`[boot:resize] ${renderResult.message}`);
	}
});

if (command === 'gui') {
	const guiResult = await startGui({repoRoot: process.cwd()});

	if (isFail(guiResult)) {
		console.error(chalk.red(`Failed to start Epiq GUI:\n${guiResult.message}`));
		process.exitCode = 1;
	}
} else {
	console.clear();

	const bootResult = await bootTui();

	if (isFail(bootResult)) {
		logger.info(bootResult.message);
		console.error(chalk.red(`Failed to boot Epiq:\n${bootResult.message}`));
		process.exitCode = 1;
	}
}
