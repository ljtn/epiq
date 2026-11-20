// Events read from the log are shared between loads: freeze them, so code that
// writes into one fails a test rather than corrupting the next load.
process.env['EPIQ_FREEZE_EVENTS'] = '1';
