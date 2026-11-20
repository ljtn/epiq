import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

// Copies the bins out of the checkout, so no node_modules is in reach.
const isolatedDist = (): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-e2e-bundle-'));
	fs.cpSync('dist', path.join(dir, 'dist'), {
		recursive: true,
		filter: source => !source.includes(`${path.sep}gui${path.sep}`),
	});
	fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
	return dir;
};

const run = async (
	dir: string,
	bin: string,
	args: string[],
): Promise<{code: number | null; stderr: string}> => {
	// A shell that sets no NODE_ENV, as a user's does; vitest sets one.
	const env: NodeJS.ProcessEnv = {
		...process.env,
		EPIQ_GLOBAL_DIR: path.join(dir, 'global'),
	};
	delete env['NODE_ENV'];

	const child = spawn(process.execPath, [path.join(dir, bin), ...args], {
		cwd: dir,
		env,
		stdio: ['pipe', 'ignore', 'pipe'],
	});
	let stderr = '';
	child.stderr.on('data', chunk => {
		stderr += String(chunk);
	});
	child.stdin.end();

	const code = await new Promise<number | null>(resolve => {
		const timer = setTimeout(() => child.kill(), 10_000);
		child.once('exit', exitCode => {
			clearTimeout(timer);
			resolve(exitCode);
		});
	});

	return {code, stderr};
};

const bundle = (): string =>
	fs
		.readdirSync('dist')
		.filter(file => file.endsWith('.js'))
		.map(file => fs.readFileSync(path.join('dist', file), 'utf8'))
		.join('\n');

describe('the npm bins are self-contained', () => {
	it.each([
		['epiq', 'dist/index.js', ['--version']],
		['epiq-mcp', 'dist/mcp.js', []],
	])('%s runs with no node_modules', async (_name, bin, args) => {
		const dir = isolatedDist();
		const result = await run(dir, bin, args);
		fs.rmSync(dir, {recursive: true, force: true});

		expect(result.stderr).toBe('');
		expect(result.code).toBe(0);
	});

	it("bundles React's production build", () => {
		const code = bundle();

		expect(code).toContain('react.dev/errors/');
		expect(code).not.toContain('unique "key" prop');
	});
});
