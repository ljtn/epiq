import chalk from 'chalk';
import {isFail, Result, succeeded} from '../lib/model/result-types.js';
import {openBrowser} from './open-browser.js';
import {startGuiServer} from './api/api-server.js';

export const startGui = async (input: {
	repoRoot: string;
}): Promise<Result<{url: string}>> => {
	const serverResult = await startGuiServer({...input, boardId: ''});

	if (isFail(serverResult)) return serverResult;

	const {url} = serverResult.value;

	console.log(`Epiq GUI running at ${chalk.cyan(url)}`);

	openBrowser(url);

	return succeeded('Started GUI', {url});
};
