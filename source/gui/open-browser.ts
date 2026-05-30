import {spawn} from 'node:child_process';
import process from 'node:process';

export const openBrowser = (url: string) => {
	const command =
		process.platform === 'darwin'
			? 'open'
			: process.platform === 'win32'
			? 'cmd'
			: 'xdg-open';

	const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];

	spawn(command, args, {
		detached: true,
		stdio: 'ignore',
	}).unref();
};
