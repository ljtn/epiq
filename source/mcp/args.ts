import {EPIQ_VERSION} from '../version.js';

const HELP = `epiq-mcp ${EPIQ_VERSION}

Usage: epiq-mcp [name]

  name  the board identity this server writes under, e.g. claude/peter
        (equivalent to setting EPIQ_USER_NAME)

Options:
  -v, --version  print the version
  -h, --help     print this help
`;

export type McpArgs =
	| {kind: 'none'}
	| {kind: 'name'; name: string}
	| {kind: 'print'; text: string}
	| {kind: 'error'; message: string};

/**
 * A flag is never a name. `isValidUserName` only measures length, so an
 * unchecked argument means `epiq-mcp --version` starts the server under the
 * identity `--version`, and the first write makes that a contributor the board
 * cannot be rid of.
 */
export const parseMcpArgs = (args: string[]): McpArgs => {
	if (args.length > 1) {
		return {
			kind: 'error',
			message: `Expected at most one name argument, got ${args.length}`,
		};
	}

	const argument = args[0];

	if (argument === undefined) return {kind: 'none'};

	if (argument === '--version' || argument === '-v') {
		return {kind: 'print', text: `${EPIQ_VERSION}\n`};
	}

	if (argument === '--help' || argument === '-h') {
		return {kind: 'print', text: HELP};
	}

	if (argument.startsWith('-')) {
		return {
			kind: 'error',
			message: `Unknown option ${argument}; expected a name, e.g. epiq-mcp claude/peter`,
		};
	}

	return {kind: 'name', name: argument};
};
