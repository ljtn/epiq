// The npm bin. React and ink are external there and pick their build from
// NODE_ENV when first imported, so it is set before the app loads. Their
// development build logs a performance measure per render, which Node keeps
// for the life of the process.
process.env['NODE_ENV'] ??= 'production';

await import('./Index.js');
