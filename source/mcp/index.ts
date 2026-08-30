process.env['EPIQ_MCP'] = 'true';

console.log = console.error;
console.info = console.error;
console.debug = console.error;
console.warn = console.error;

// Nothing the MCP serves reads a ticket's virtual fields, and building them is
// most of the cost of a replay.
const {setVirtualNodesEnabled} = await import(
	'../lib/virtual-nodes/virtual-nodes.js'
);
setVirtualNodesEnabled(false);

const {startMcpServer} = await import('./server.js');
await startMcpServer();
