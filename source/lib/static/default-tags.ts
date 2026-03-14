export type TagColor =
	| 'gray'
	| 'red'
	| 'green'
	| 'yellow'
	| 'blue'
	| 'magenta'
	| 'cyan'
	| string;

export type TagsDefault = Record<string, TagColor>;

export const TAGS_DEFAULT: TagsDefault = {
	// RED — urgent / failures
	urgent: 'red',
	critical: 'red',
	important: 'red',
	blocker: 'red',
	asap: 'red',
	immediate: 'red',
	fail: 'red',
	failure: 'red',
	broken: 'red',
	bug: 'red',
	error: 'red',
	incident: 'red',
	outage: 'red',
	production: 'red',
	crash: 'red',
	security: 'red',

	// YELLOW — warnings / review
	warning: 'yellow',
	warn: 'yellow',
	risky: 'yellow',
	risk: 'yellow',
	attention: 'yellow',
	pending: 'yellow',
	review: 'yellow',
	'needs-review': 'yellow',
	qa: 'yellow',
	testing: 'yellow',
	test: 'yellow',
	validate: 'yellow',
	verification: 'yellow',
	staging: 'yellow',
	check: 'yellow',
	'follow-up': 'yellow',
	followup: 'yellow',
	waiting: 'yellow',
	blocked: 'yellow',
	hold: 'yellow',

	// GREEN — completed / healthy
	done: 'green',
	complete: 'green',
	completed: 'green',
	success: 'green',
	ok: 'green',
	stable: 'green',
	resolved: 'green',
	fixed: 'green',
	closed: 'green',
	merged: 'green',
	released: 'green',
	deployed: 'green',
	approved: 'green',
	verified: 'green',
	working: 'green',
	healthy: 'green',
	pass: 'green',
	passing: 'green',

	// BLUE — information / docs
	info: 'blue',
	information: 'blue',
	note: 'blue',
	docs: 'blue',
	documentation: 'blue',
	doc: 'blue',
	guide: 'blue',
	help: 'blue',
	explanation: 'blue',
	detail: 'blue',
	details: 'blue',
	context: 'blue',
	design: 'blue',
	discussion: 'blue',
	proposal: 'blue',
	idea: 'blue',

	// MAGENTA — engineering work
	feature: 'magenta',
	enhancement: 'magenta',
	improvement: 'magenta',
	refactor: 'magenta',
	refactoring: 'magenta',
	cleanup: 'magenta',
	optimize: 'magenta',
	optimization: 'magenta',
	perf: 'magenta',
	performance: 'magenta',
	upgrade: 'magenta',
	migration: 'magenta',
	modernize: 'magenta',
	debt: 'magenta',

	// CYAN — planning / backlog
	todo: 'cyan',
	next: 'cyan',
	planned: 'cyan',
	plan: 'cyan',
	future: 'cyan',
	backlog: 'cyan',
	investigate: 'cyan',
	explore: 'cyan',
	prototype: 'cyan',
};
