import {spawn} from 'node:child_process';

export function openUrl(url: string): boolean {
	const platform = process.platform;

	const command =
		platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';

	const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];

	const child = spawn(command, args, {
		detached: true,
		stdio: 'ignore',
		shell: false,
	});

	child.unref();

	child.on('error', () => {
		// fall back to printing the URL in your command UI
	});

	return true;
}
