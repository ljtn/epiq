import http from 'node:http';
import {describe, expect, it} from 'vitest';
import {startGuiServer} from '../../gui/api/api-server.js';
import {isFail} from '../../lib/model/result-types.js';
import {checkoutStateAt, returnToLive} from '../../mcp/epiq-time-travel.js';
import {commonSteps} from './e2e-common-steps.js';
import {setupTui} from './e2e.helper.js';

const testTimeout = 60_000;

const httpRequest = async (
	base: string,
	method: string,
	pathName: string,
	body?: unknown,
): Promise<{status: number; body: string}> =>
	new Promise((resolve, reject) => {
		const request = http.request(
			`${base}${pathName}`,
			{
				method,
				headers: body ? {'content-type': 'application/json'} : {},
			},
			response => {
				const chunks: Buffer[] = [];
				response.on('data', chunk => chunks.push(chunk));
				response.on('end', () =>
					resolve({
						status: response.statusCode ?? 0,
						body: Buffer.concat(chunks).toString(),
					}),
				);
			},
		);

		request.on('error', reject);
		if (body) request.write(JSON.stringify(body));
		request.end();
	});

describe('GUI mutation guard while time-travelling', () => {
	it(
		'refuses writes over HTTP while checked out, and resumes once live',
		async () => {
			const tui = setupTui();

			try {
				await commonSteps.configureInitialSettings(tui);
				await commonSteps.init(tui);

				const repoRoot = tui.cwd;

				const serverResult = await startGuiServer({repoRoot, boardId: ''});
				expect(isFail(serverResult)).toBe(false);
				if (isFail(serverResult)) return;

				const {server} = serverResult.value;
				const address = server.address();
				if (!address || typeof address === 'string') {
					throw new Error('No server address');
				}

				const base = `http://127.0.0.1:${address.port}`;
				// Not a real issue: the guard refuses before any lookup. 409-vs-400
				// separates "guard stopped it" from "it got through and failed".
				const comment = {issueId: 'NO-SUCH-ISSUE', body: 'hello'};

				try {
					const live = await httpRequest(
						base,
						'POST',
						'/api/comments',
						comment,
					);
					expect(live.status).toBe(400);
					expect(live.body).toContain('Issue not found');

					const checkout = await checkoutStateAt({
						repoRoot,
						targetTime: Date.now() - 60_000,
					});
					expect(isFail(checkout)).toBe(false);

					const scrubbed = await httpRequest(
						base,
						'POST',
						'/api/comments',
						comment,
					);
					expect(scrubbed.status).toBe(409);
					expect(scrubbed.body).toContain('Read-only while viewing history');

					// Two in a row: a refusal must still release the shared lock.
					const alsoScrubbed = await httpRequest(
						base,
						'POST',
						'/api/comments',
						comment,
					);
					expect(alsoScrubbed.status).toBe(409);

					const backLive = await returnToLive({repoRoot});
					expect(isFail(backLive)).toBe(false);

					const afterLive = await httpRequest(
						base,
						'POST',
						'/api/comments',
						comment,
					);
					expect(afterLive.status).toBe(400);
					expect(afterLive.body).toContain('Issue not found');
				} finally {
					server.close();
				}
			} finally {
				tui.destroy();
			}
		},
		testTimeout,
	);
});
