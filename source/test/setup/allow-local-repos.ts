// The suites connect repos from local paths so nothing reaches the network;
// a real board refuses them, since nobody else could fetch them.
process.env['EPIQ_ALLOW_LOCAL_REPOS'] = '1';
