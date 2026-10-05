import {spawn} from 'node:child_process';
import process from 'node:process';

// Elsewhere xdg-open needs a display, or a $BROWSER to hand the URL to (how WSL
// opens the Windows one). With neither, the banner's URL is the way in.
export const canOpenBrowser = (
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): boolean =>
	platform === 'darwin' ||
	platform === 'win32' ||
	Boolean(env['DISPLAY'] || env['WAYLAND_DISPLAY'] || env['BROWSER']);

// Best-effort: a missing opener (a slim container has no xdg-open) must not take
// the server down with it.
export const openBrowser = (url: string) => {
	const command =
		process.platform === 'darwin'
			? 'open'
			: process.platform === 'win32'
			? 'cmd'
			: 'xdg-open';

	const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];

	try {
		const child = spawn(command, args, {
			detached: true,
			stdio: 'ignore',
		});

		child.on('error', error => {
			logger.info(`[gui] could not open a browser: ${error.message}`);
		});
		child.unref();
	} catch (error) {
		logger.info(`[gui] could not open a browser: ${String(error)}`);
	}
};
