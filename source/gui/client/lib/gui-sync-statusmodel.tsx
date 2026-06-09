export type SyncStatus = {
	status: 'synced' | 'failed' | 'syncing';
	msg: string;
};
