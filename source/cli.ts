import {exitOnOldNode} from './lib/utils/node-version.js';

exitOnOldNode();

// Before the app loads: run unbundled, React and ink read NODE_ENV on import.
process.env['NODE_ENV'] ||= 'production';

await import('./Index.js');
