process.env['EPIQ_MCP'] = 'true';

console.log = console.error;
console.info = console.error;
console.debug = console.error;
console.warn = console.error;

// Before anything reads the environment: one positional argument names this
// server, saving every client config an `env` block for the common case.
const {applyActorNameArgument} = await import('../lib/config/actor-env.js');
const {isFail} = await import('../lib/model/result-types.js');
const {parseMcpArgs} = await import('./args.js');
const parsed = parseMcpArgs(process.argv.slice(2));

if (parsed.kind === 'error') {
	console.error(parsed.message);
	process.exit(1);
}

// `console.log` is stderr here, and a version is worth piping.
if (parsed.kind === 'print') {
	process.stdout.write(parsed.text);
	process.exit(0);
}

if (parsed.kind === 'name') {
	const applied = applyActorNameArgument(parsed.name, 'The name argument');

	if (isFail(applied)) {
		console.error(applied.message);
		process.exit(1);
	}
}

// Nothing the MCP serves reads a ticket's virtual fields, and building them is
// most of the cost of a replay.
const {setVirtualNodesEnabled} = await import(
	'../lib/virtual-nodes/virtual-nodes.js'
);
setVirtualNodesEnabled(false);

const {startMcpServer} = await import('./server.js');
await startMcpServer();
