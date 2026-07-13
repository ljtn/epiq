import {spawn} from 'node:child_process';
import {failed, Result, succeeded} from '../model/result-types.js';

// Each platform ships its own clipboard writer; on Linux prefer the Wayland
// tool when a Wayland session is detected, otherwise X11's xclip.
const resolveClipboardCommand = (): {command: string; args: string[]} => {
	switch (process.platform) {
		case 'darwin':
			return {command: 'pbcopy', args: []};
		case 'win32':
			return {command: 'clip', args: []};
		default:
			return process.env['WAYLAND_DISPLAY']
				? {command: 'wl-copy', args: []}
				: {command: 'xclip', args: ['-selection', 'clipboard']};
	}
};

export const copyTextToClipboard = async (
	text: string,
): Promise<Result<null>> =>
	new Promise(resolve => {
		const {command, args} = resolveClipboardCommand();

		try {
			const child = spawn(command, args, {stdio: ['pipe', 'ignore', 'ignore']});

			child.on('error', () =>
				resolve(failed(`Clipboard tool not available (${command})`)),
			);

			child.on('close', code =>
				resolve(
					code === 0
						? succeeded('Copied to clipboard', null)
						: failed(`Clipboard tool failed (${command})`),
				),
			);

			child.stdin.on('error', () => {
				// swallow EPIPE from a failed spawn; the 'error' handler resolves
			});

			child.stdin.write(text);
			child.stdin.end();
		} catch {
			resolve(failed(`Clipboard tool not available (${command})`));
		}
	});
