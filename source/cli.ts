// Before the app loads: React and ink are external and read NODE_ENV on import.
process.env['NODE_ENV'] ||= 'production';

await import('./Index.js');
