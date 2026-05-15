process.env['EPIQ_MCP'] = 'true';

console.log = console.error;
console.info = console.error;
console.debug = console.error;
console.warn = console.error;

await import('./server.js');
