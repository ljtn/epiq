// Answered with a `<type>:result` before the fresh state, which is what lets
// the client hold broadcasts until its own change has landed.
export const MUTATING_MESSAGE_TYPES = new Set<string>([
	'sync',
	'issues:create',
	'issues:move',
	'issue:close',
	'issue:reopen',
	'issue:edit:title',
	'issue:edit:description',
	'issue:tag:add',
	'issue:tag:remove',
	'contributor:remove',
	'issue:assignee:add',
	'issue:assignee:remove',
	'issue:comment:add',
	'issue:comment:delete',
]);
