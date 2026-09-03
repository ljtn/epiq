import {describe, expect, it, vi} from 'vitest';

// Every entry point server.ts imports must exist on the mock.
vi.mock('../mcp/epiq-api.js', () => ({
	addIssueAssignee: vi.fn(),
	addIssueAttachment: vi.fn(),
	getBoardContributors: vi.fn(),
	tombstoneContributor: vi.fn(),
	restoreContributor: vi.fn(),
	tombstoneTag: vi.fn(),
	restoreTag: vi.fn(),
	addIssueComment: vi.fn(),
	addIssueTag: vi.fn(),
	assumeActor: vi.fn(),
	closeIssue: vi.fn(),
	createIssue: vi.fn(),
	createSwimlane: vi.fn(),
	deleteIssueComment: vi.fn(),
	editIssueComment: vi.fn(),
	deleteSwimlane: vi.fn(),
	editIssueDescription: vi.fn(),
	editIssueTitle: vi.fn(),
	editSwimlaneTitle: vi.fn(),
	getEpiqState: vi.fn(),
	getIssue: vi.fn(),
	listBoards: vi.fn(),
	listIssues: vi.fn(),
	listSwimlanes: vi.fn(),
	moveIssue: vi.fn(),
	moveSwimlane: vi.fn(),
	removeIssueAssignee: vi.fn(),
	removeIssueTag: vi.fn(),
	reopenIssue: vi.fn(),
	sync: vi.fn(),
}));

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {succeeded} from '../lib/model/result-types.js';
import {closeIssue, createIssue} from '../mcp/epiq-api.js';
import {createMcpServer} from '../mcp/server.js';

// The MCP SDK does not serialize requests, and every epiq-api call is a
// boot-read-persist over the shared state singleton across several awaits.
// Unwrapped handlers let one call's boot() rebuild the state another call had
// already checked its preconditions against — the GUI transports take
// `runExclusive` for exactly this, and the MCP tools did not.
describe('MCP tool serialization', () => {
	it('runs concurrent tool calls one at a time, never interleaved', async () => {
		const trace: string[] = [];

		const track = (label: string, fn: unknown) => {
			vi.mocked(fn as () => Promise<unknown>).mockImplementation(async () => {
				trace.push(`${label}:enter`);
				await new Promise(resolve => setTimeout(resolve, 20));
				trace.push(`${label}:exit`);
				return succeeded('ok', {});
			});
		};

		track('create', createIssue);
		track('close', closeIssue);

		const server = createMcpServer();
		const client = new Client({name: 'race-test', version: '0.0.0'});
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);

		await Promise.all([
			client.callTool({
				name: 'epiq_issue_create',
				arguments: {title: 'race', parentId: 'lane-1'},
			}),
			client.callTool({
				name: 'epiq_issue_close',
				arguments: {issueId: 'issue-1'},
			}),
		]);

		expect(trace).toHaveLength(4);

		// Whichever call goes first, its exit must precede the other's enter.
		for (let index = 0; index < trace.length; index += 2) {
			expect(trace[index]).toMatch(/:enter$/);
			expect(trace[index + 1]).toBe(trace[index]?.replace(':enter', ':exit'));
		}

		await client.close();
		await server.close();
	});
});
