import {expect} from 'vitest';
import {commonSteps} from './e2e-common-steps.js';
import {setupTui} from './e2e.helper.js';

export default async () => {
	const tui = setupTui();

	try {
		// Only run once
		await commonSteps.configureInitialSettings(tui);

		let output = await tui.waitFor('Initialize project');

		expect(output).toContain('This folder is not an epiq project yet.');

		tui.input(':init\r');
		output = await tui.waitFor('Not inside a Git repository');

		expect(output).toContain('Not inside a Git repository');
	} finally {
		tui.destroy();
	}
};
