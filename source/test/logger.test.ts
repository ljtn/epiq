import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, beforeEach, describe, expect, it} from 'vitest';
import {
	enforceLogHorizon,
	logger,
	MAX_BYTES,
	MAX_LINES,
	MAX_MESSAGE_CHARS,
} from '../logger.js';

const originalCwd = process.cwd();
let root: string;
let logPath: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'epiq-logger-'));
	fs.mkdirSync(path.join(root, '.epiq'));
	logPath = path.join(root, '.epiq', 'log', 'epiq.log');
	process.chdir(root);
});

afterEach(() => {
	process.chdir(originalCwd);
	fs.rmSync(root, {recursive: true, force: true});
});

const lineOf = (chars: number, fill = 'x') => fill.repeat(chars) + '\n';

describe('enforceLogHorizon', () => {
	it('keeps a log under both caps as it is', () => {
		const content = lineOf(10).repeat(MAX_LINES);
		fs.mkdirSync(path.dirname(logPath), {recursive: true});
		fs.writeFileSync(logPath, content);

		enforceLogHorizon(logPath);

		expect(fs.readFileSync(logPath, 'utf8')).toBe(content);
	});

	it('trims to the last lines when the line cap is passed', () => {
		fs.mkdirSync(path.dirname(logPath), {recursive: true});
		fs.writeFileSync(
			logPath,
			lineOf(3, 'a').repeat(20) + lineOf(3, 'b').repeat(MAX_LINES),
		);

		enforceLogHorizon(logPath);

		const lines = fs.readFileSync(logPath, 'utf8').split('\n');
		expect(lines.pop()).toBe('');
		expect(lines).toHaveLength(MAX_LINES);
		expect(lines.every(line => line === 'bbb')).toBe(true);
	});

	it('trims by bytes when a few long lines pass the byte cap', () => {
		// Well under the line cap, well over the byte cap: what a handful of
		// multi-megabyte stack traces did to a real log.
		const longLine = lineOf(MAX_BYTES / 2);
		fs.mkdirSync(path.dirname(logPath), {recursive: true});
		fs.writeFileSync(logPath, longLine.repeat(5) + lineOf(5, 'y'));

		enforceLogHorizon(logPath);

		const kept = fs.readFileSync(logPath, 'utf8');
		expect(Buffer.byteLength(kept)).toBeLessThanOrEqual(MAX_BYTES);
		// The cut lands on a line boundary, so a partial line is dropped.
		expect(kept).toBe(longLine + lineOf(5, 'y'));
	});
});

describe('logger', () => {
	it('clips a single oversized message', () => {
		logger.info('x'.repeat(MAX_MESSAGE_CHARS * 3));

		const written = fs.readFileSync(logPath, 'utf8');
		expect(written.length).toBeLessThan(MAX_MESSAGE_CHARS + 200);
		expect(written).toContain(`[${MAX_MESSAGE_CHARS * 2} more chars]`);
	});

	it('trims an inherited oversized log on the next write', () => {
		fs.mkdirSync(path.dirname(logPath), {recursive: true});
		fs.writeFileSync(logPath, lineOf(MAX_BYTES / 2).repeat(3));

		logger.info('hello');

		expect(fs.statSync(logPath).size).toBeLessThanOrEqual(MAX_BYTES);
		expect(fs.readFileSync(logPath, 'utf8')).toContain('[Info] hello');
	});

	it('never throws when the log cannot be written', () => {
		// A file where the log directory should be: mkdir and append both fail.
		fs.writeFileSync(path.join(root, '.epiq', 'log'), '');

		expect(() => logger.error('boom')).not.toThrow();
	});
});
