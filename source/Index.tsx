import chalk from 'chalk';
import {render} from 'ink';
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
import {initFromCli} from './cli-init.js';
import {getUserSetupStatus} from './lib/config/setup-utils.js';
import {
	openSetupStep,
	openSetupRerunStep,
	startSetupRerun,
} from './lib/command-line/setup-flow.js';
import {setScreenRelease} from './lib/actions/default/navigation-action-utils.js';
import {patchSetupSession} from './lib/state/setup-session.state.js';
import {parseCliArgs} from './lib/command-line/cli-args.js';

initUiState();

const helpText = `
${chalk.bold('Epiq CLI')}

${chalk.dim('Boot in directory:')}
  ${chalk.cyan('$ epiq')}

${chalk.dim('Set up this machine, or change it later (name, auto sync):')}
  ${chalk.cyan('$ epiq setup')}

${chalk.dim('Start a board in this repository, without the TUI:')}
  ${chalk.cyan('$ epiq init')}

${chalk.dim('Launch GUI:')}
  ${chalk.cyan('$ epiq gui')}
  ${chalk.cyan('$ epiq gui --no-open')}  ${chalk.dim('no browser')}

${chalk.dim('Act as somebody other than the configured user:')}
  ${chalk.cyan('$ epiq --as claude')}
`;

const cli = parseCliArgs(process.argv.slice(2));

if (cli.kind === 'help' || cli.kind === 'version') {
	console.log(
		cli.kind === 'help' ? helpText.replace(/^(?=.)/gm, '  ') : EPIQ_VERSION,
	);
	process.exit(0);
}

if (cli.kind === 'error') {
	console.error(chalk.red(cli.message));
	process.exit(1);
}

const {command} = cli;

if (cli.as !== undefined) {
	const actor = applyActorNameArgument(cli.as, '--as');

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
			ink = render(node, {
				incrementalRendering: true,
				// Ink reads a `CI` variable as non-interactive and draws nothing.
				interactive: Boolean(process.stdout.isTTY),
			});
			setScreenRelease(() => {
				ink?.unmount();
				process.stdout.write('\x1B[2J\x1B[H');
			});
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

if (command === 'init') {
	const initResult = await initFromCli(process.cwd());

	if (isFail(initResult)) {
		console.error(chalk.red(initResult.message));
		process.exitCode = 1;
	} else {
		console.log(initResult.message);
	}
} else if (command === 'gui') {
	const guiResult = await startGui({
		repoRoot: process.cwd(),
		open: cli.open,
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
	} else {
		if (command === 'setup') patchSetupSession({quitWhenDone: true});

		if (command === 'setup' && getUserSetupStatus().isMachineSetupDone) {
			startSetupRerun();
			openSetupRerunStep();
		} else {
			openSetupStep();
		}
	}
}
