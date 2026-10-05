import {EventEmitter} from 'node:events';
import {beforeEach, describe, expect, it, vi} from 'vitest';

const child = Object.assign(new EventEmitter(), {unref: vi.fn()});

vi.mock('node:child_process', () => ({spawn: vi.fn(() => child)}));

import {spawn} from 'node:child_process';
import {canOpenBrowser, openBrowser} from '../gui/open-browser.js';

const logged = vi.fn();
vi.stubGlobal('logger', {info: logged, debug: vi.fn(), error: vi.fn()});

beforeEach(() => {
	child.removeAllListeners();
	logged.mockClear();
	vi.mocked(spawn).mockClear();
});

describe('openBrowser', () => {
	// A slim container has no xdg-open: spawn reports ENOENT as an 'error'
	// event, which with no listener is thrown and ends the process.
	it('survives a missing opener', () => {
		openBrowser('http://127.0.0.1:3710');

		expect(spawn).toHaveBeenCalledOnce();
		expect(() =>
			child.emit('error', new Error('spawn xdg-open ENOENT')),
		).not.toThrow();
		expect(logged).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
	});
});

describe('canOpenBrowser', () => {
	it('opens on macOS and Windows', () => {
		expect(canOpenBrowser('darwin', {})).toBe(true);
		expect(canOpenBrowser('win32', {})).toBe(true);
	});

	it('opens on Linux only with a display', () => {
		expect(canOpenBrowser('linux', {})).toBe(false);
		expect(canOpenBrowser('linux', {DISPLAY: ':0'})).toBe(true);
		expect(canOpenBrowser('linux', {WAYLAND_DISPLAY: 'wayland-0'})).toBe(true);
	});

	it('opens without a display when $BROWSER names one, as on WSL', () => {
		expect(canOpenBrowser('linux', {BROWSER: 'wslview'})).toBe(true);
	});
});
