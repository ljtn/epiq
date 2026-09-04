'use strict';
// The SEA bootstrap (build-sea.mjs) loads the app from a data: URL, so V8
// names the script by that URL and every stack frame would carry the whole
// base64 bundle: one logged error is tens of megabytes, and a crash pasted
// into a terminal is unreadable. This formats stacks the way Node does and
// swaps the bundle URL for a short name.
//
// Inlined into the bootstrap as plain script, so it must not depend on
// `module` or `require`.
/* global module */
const SEA_BUNDLE_URL = /data:application\/javascript;base64,[A-Za-z0-9+/=]+/g;
const SEA_BUNDLE_NAME = 'epiq-sea';

function prepareStackTrace(error, callSites) {
	let header;
	try {
		header = Error.prototype.toString.call(error);
	} catch {
		header = 'Error';
	}

	const lines = [header];
	for (const site of callSites) {
		lines.push(`    at ${site}`);
	}

	return lines.join('\n').replace(SEA_BUNDLE_URL, SEA_BUNDLE_NAME);
}

if (typeof module === 'object' && module.exports) {
	module.exports = {prepareStackTrace, SEA_BUNDLE_NAME};
}
