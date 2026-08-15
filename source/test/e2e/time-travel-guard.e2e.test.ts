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
				// Deliberately not a real issue: a refused write is refused before
				// the issue is ever looked up, so nothing here can mutate.
				//
				// Asserted as "409 or not 409" rather than on the success status,
				// because these routes report a failed Result as 200 (see board:
				// "HTTP comment routes report failures as 200"). 409 is the guard
				// and is unaffected by that.
				const comment = {issueId: 'NO-SUCH-ISSUE', body: 'hello'};

				try {
					const live = await httpRequest(
						base,
						'POST',
						'/api/comments',
						comment,
					);
					expect(live.status).not.toBe(409);
					expect(live.body).not.toContain('Read-only');

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

					// Two in a row: the guard runs inside the shared lock, so a
					// second request must still be answered rather than queue behind
					// a lock that was never released.
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
					expect(afterLive.status).not.toBe(409);
					expect(afterLive.body).not.toContain('Read-only');
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
