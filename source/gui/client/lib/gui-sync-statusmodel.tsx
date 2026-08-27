export type SyncStatus = {
	// 'offline' is not a failure: local work is committed, the remote is not
	// reachable. Kept in step with the same union in app-state.model.
	status: 'synced' | 'failed' | 'offline' | 'syncing';
	msg: string;
};
