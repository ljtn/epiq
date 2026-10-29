import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {succeeded} from '../../lib/model/result-types.js';

vi.mock('../epiq-api.js', async importOriginal => ({
	...(await importOriginal<typeof import('../epiq-api.js')>()),
	listIssues: vi.fn(async () => succeeded('Listed issues', [])),
}));

const {listIssues} = await import('../epiq-api.js');
const {createMcpServer} = await import('../server.js');

describe('MCP tool list', () => {
	let client: Client;
	let server: ReturnType<typeof createMcpServer>;

	beforeEach(async () => {
		server = createMcpServer();
		client = new Client({name: 'tool-list-test', version: '0.0.0'});
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		await Promise.all([
			server.connect(serverTransport),
			client.connect(clientTransport),
		]);
	});

	afterEach(async () => {
		await client.close();
		await server.close();
	});

	it('carries no $schema line, and keeps the rest of each schema', async () => {
		const {tools} = await client.listTools();

		expect(tools.length).toBeGreaterThan(40);
		expect(tools.filter(tool => '$schema' in tool.inputSchema)).toEqual([]);
		expect(
			tools.find(tool => tool.name === 'epiq_issue_create')?.inputSchema,
		).toMatchObject({
			type: 'object',
			required: ['title', 'parentId'],
			properties: {title: {type: 'string', minLength: 1}},
		});
	});

	it('lists issues brief unless asked for the full ticket', async () => {
		await client.callTool({name: 'epiq_issue_list', arguments: {}});
		await client.callTool({
			name: 'epiq_issue_list',
			arguments: {brief: false},
		});

		expect(vi.mocked(listIssues).mock.calls).toEqual([
			[{brief: true}],
			[{brief: false}],
		]);
	});
});
