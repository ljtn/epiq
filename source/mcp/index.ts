process.env['EPIQ_MCP'] = 'true';

console.log = console.error;
console.info = console.error;
console.debug = console.error;
console.warn = console.error;

// Before anything reads the environment: one positional argument names this
// server, saving every client config an `env` block for the common case.
const {applyActorNameArgument} = await import('../lib/config/actor-env.js');
const {isFail} = await import('../lib/model/result-types.js');
const args = process.argv.slice(2);

if (args.length > 1) {
	console.error(`Expected at most one name argument, got ${args.length}`);
	process.exit(1);
}

if (args[0] !== undefined) {
	const applied = applyActorNameArgument(args[0], 'The name argument');

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
