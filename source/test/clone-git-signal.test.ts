import {spawn} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';

const HOLDER = fileURLToPath(
	new URL('./helpers/clone-git-holder.ts', import.meta.url),
);

const within = <T>(promise: Promise<T>, ms: number, what: string) =>
	Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`no ${what} in ${ms}ms`)), ms),
		),
	]);

describe('git started for a clone', () => {
	for (const listener of [
		'alone',
		'with-signal-exit',
		'stubborn-helper',
	] as const) {
		for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
			it(`is stopped when the process gets ${signal} ${
				listener === 'alone'
					? 'with nothing else listening'
					: listener === 'with-signal-exit'
					? "beside Ink's exit handler"
					: 'with a helper that ignores SIGTERM'
			}, and the process still exits`, async () => {
				const dir = fs.mkdtempSync(
					path.join(os.tmpdir(), 'epiq-clone-signal-'),
				);
				let connected!: () => void;
				let closed!: () => void;
				const connection = new Promise<void>(resolve => (connected = resolve));
				const hangUp = new Promise<void>(resolve => (closed = resolve));

				// Never answers: git waits on it until it is killed.
				const server = net.createServer(socket => {
					socket.on('close', closed);
					socket.on('error', () => {});
					// Read, so git's hang-up arrives as an end.
					socket.resume();
					connected();
				});
				await new Promise<void>(resolve =>
					server.listen(0, '127.0.0.1', resolve),
				);
				const {port} = server.address() as net.AddressInfo;

				// Pipes git to the server, and holds the connection through the
				// polite signals and through git going away: only SIGKILL ends it.
				const proxy = path.join(dir, 'stubborn-proxy.sh');
				fs.writeFileSync(
					proxy,
					[
						'#!/bin/sh',
						`exec "${process.execPath}" -e '`,
						`for (const s of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(s, () => {});`,
						`const c = require("net").connect(${port}, "127.0.0.1");`,
						`process.stdin.on("data", d => c.write(d));`,
						`c.on("data", d => process.stdout.write(d));`,
						`process.stdout.on("error", () => {});`,
						// Gone by itself in the end, should a failing run leave it.
						`setTimeout(() => process.exit(), 30000);'`,
						'',
					].join('\n'),
				);
				fs.chmodSync(proxy, 0o755);

				const holder = spawn(
					process.execPath,
					[
						'--import',
						'tsx',
						HOLDER,
						String(port),
						dir,
						listener,
						...(listener === 'stubborn-helper' ? [proxy] : []),
					],
					{stdio: 'ignore'},
				);
				const exited = new Promise<NodeJS.Signals | number | null>(resolve =>
					holder.on('exit', (code, sig) => resolve(sig ?? code)),
				);

				try {
					await within(connection, 20_000, 'connection');
					holder.kill(signal);

					expect(await within(exited, 10_000, 'exit')).toBe(signal);
					await within(hangUp, 10_000, 'hang-up from git');
				} finally {
					holder.kill('SIGKILL');
					server.close();
					fs.rmSync(dir, {recursive: true, force: true});
				}
			}, 60_000);
		}
	}
});
