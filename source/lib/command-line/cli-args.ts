import {parseArgs} from 'node:util';
import {formatUnknownError} from '../utils/logger.utils.js';

const COMMANDS = ['gui', 'setup', 'init'] as const;

export type CliCommand = (typeof COMMANDS)[number];

export type CliArgs =
	| {kind: 'run'; command?: CliCommand; as?: string; open: boolean}
	| {kind: 'help'}
	| {kind: 'version'}
	| {kind: 'error'; message: string};

const isCommand = (value: string): value is CliCommand =>
	(COMMANDS as readonly string[]).includes(value);

const parse = (args: string[]) => {
	try {
		return parseArgs({
			args,
			allowPositionals: true,
			options: {
				as: {type: 'string'},
				open: {type: 'boolean'},
				'no-open': {type: 'boolean'},
				help: {type: 'boolean', short: 'h'},
				version: {type: 'boolean', short: 'v'},
			},
		});
	} catch (error) {
		return formatUnknownError(error);
	}
};

export const parseCliArgs = (args: string[]): CliArgs => {
	const parsed = parse(args);

	if (typeof parsed === 'string') return {kind: 'error', message: parsed};

	const {values, positionals} = parsed;

	if (values.help) return {kind: 'help'};
	if (values.version) return {kind: 'version'};

	const [command, extra] = positionals;

	if (command !== undefined && !isCommand(command)) {
		return {kind: 'error', message: `Unknown command: ${command}`};
	}

	// `epiq init foo` must not quietly start a board here instead of in foo.
	if (extra !== undefined) {
		return {kind: 'error', message: `Unexpected argument: ${extra}`};
	}

	return {
		kind: 'run',
		command,
		as: values.as,
		open: !values['no-open'],
	};
};
