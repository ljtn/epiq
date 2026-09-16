// The log in a window of its own. The window is a mirror, not a second client:
// the board goes on slicing the log exactly as it does for the panel beside it
// and posts each slice across, and the window draws it and posts back the
// clicks. So the two can never disagree about what is in the window — the
// board's filters, its checkout and its playhead all reach the popped log
// through the one slice the panel would have been handed.
//
// Two ends, one protocol: `useLogWindow` is the board's side, `useLogMirror`
// the window's, and `parseLogWindowMessage` is the only reader of what
// arrives — a message is untrusted data until it has been through it.

import {useCallback, useEffect, useRef, useState} from 'react';
import {LogEntry} from './event-log';
import {LogDestination} from './log-destination';

// The route the window opens on. The server hands it the app shell, like a
// board path.
export const LOG_WINDOW_PATH = '/log';
// One window per board tab: a second pop-out from the same tab finds the first.
const LOG_WINDOW_NAME = 'epiq-log';
const LOG_WINDOW_FEATURES = 'popup=yes,width=520,height=760';

// Sent by the board.
export type LogLinesMessage = {
	type: 'epiq-log:lines';
	entries: LogEntry[];
	moment: number;
};

// Sent by the window.
export type LogWindowMessage =
	| {type: 'epiq-log:ready'}
	| {type: 'epiq-log:open'; destination: LogDestination}
	| {type: 'epiq-log:closed'};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isDestination = (value: unknown): value is LogDestination =>
	isRecord(value) &&
	((value['kind'] === 'commit' && typeof value['sha'] === 'string') ||
		(value['kind'] === 'ticket' &&
			typeof value['issueId'] === 'string' &&
			(value['tab'] === 'comments' || value['tab'] === 'overview')));

// What the window said, or null for anything else on the channel.
export const parseLogWindowMessage = (
	data: unknown,
): LogWindowMessage | null => {
	if (!isRecord(data)) return null;

	switch (data['type']) {
		case 'epiq-log:ready':
			return {type: 'epiq-log:ready'};
		case 'epiq-log:closed':
			return {type: 'epiq-log:closed'};
		case 'epiq-log:open':
			return isDestination(data['destination'])
				? {type: 'epiq-log:open', destination: data['destination']}
				: null;
		default:
			return null;
	}
};

// What the board said, or null. The entries are taken as they come: they are
// the board's own rows, from the same origin, and checking four hundred of
// them field by field on every slice would cost more than it guards.
export const parseLogLinesMessage = (data: unknown): LogLinesMessage | null =>
	isRecord(data) &&
	data['type'] === 'epiq-log:lines' &&
	Array.isArray(data['entries']) &&
	typeof data['moment'] === 'number'
		? {
				type: 'epiq-log:lines',
				entries: data['entries'] as LogEntry[],
				moment: data['moment'],
		  }
		: null;

// Only a message from the other end of this pair counts: same origin, and
// from the very window it was opened with (or that opened this one).
const isFrom = (event: MessageEvent, other: Window | null): boolean =>
	other !== null &&
	event.origin === window.location.origin &&
	event.source === other;

// The board's end. Opens the window, keeps it fed, follows what it asks for,
// and notices when it goes — whether it says so or is simply closed.
export const useLogWindow = ({
	entries,
	moment,
	open,
	onOpen,
}: {
	entries: readonly LogEntry[];
	moment: number;
	// The log is on at all. Turned off, the window goes with it.
	open: boolean;
	onOpen: (destination: LogDestination) => void;
}): {
	// A window is up, so the panel is not drawn beside the board.
	poppedOut: boolean;
	popOut: () => void;
} => {
	const [target, setTarget] = useState<Window | null>(null);

	// The latest slice, for the window's first ask: it says `ready` once its
	// script is up, which is after the effect below has posted anything.
	const latest = useRef({entries, moment});
	latest.current = {entries, moment};

	// Read by the message listener, which is registered once per window.
	const onOpenRef = useRef(onOpen);
	onOpenRef.current = onOpen;

	const send = useCallback((to: Window, lines: typeof latest.current) => {
		const message: LogLinesMessage = {
			type: 'epiq-log:lines',
			entries: lines.entries as LogEntry[],
			moment: lines.moment,
		};

		to.postMessage(message, window.location.origin);
	}, []);

	const popOut = useCallback(() => {
		const opened = window.open(
			LOG_WINDOW_PATH,
			LOG_WINDOW_NAME,
			LOG_WINDOW_FEATURES,
		);

		setTarget(opened);
	}, []);

	useEffect(() => {
		if (!target) return;

		const onMessage = (event: MessageEvent) => {
			if (!isFrom(event, target)) return;

			const message = parseLogWindowMessage(event.data);
			if (!message) return;

			if (message.type === 'epiq-log:ready') send(target, latest.current);
			else if (message.type === 'epiq-log:open') {
				onOpenRef.current(message.destination);
			} else setTarget(null);
		};

		// A window closed from its own frame says so on the way out; one that
		// was killed with its browser does not, so it is also asked.
		const poll = window.setInterval(() => {
			if (target.closed) setTarget(null);
		}, 1_000);

		// The board leaving takes the window with it: a log with nothing feeding
		// it would sit there looking current.
		const onPageHide = () => target.close();

		window.addEventListener('message', onMessage);
		window.addEventListener('pagehide', onPageHide);

		return () => {
			window.clearInterval(poll);
			window.removeEventListener('message', onMessage);
			window.removeEventListener('pagehide', onPageHide);
		};
	}, [target, send]);

	useEffect(() => {
		if (target) send(target, {entries, moment});
	}, [target, entries, moment, send]);

	useEffect(() => {
		if (open || !target) return;

		target.close();
		setTarget(null);
	}, [open, target]);

	return {poppedOut: target !== null && open, popOut};
};

// The window's end: what the board has sent so far, and the way to answer.
// Null lines until the first slice lands — and for good when there is no
// board, which is what opening the route by hand gets.
export const useLogMirror = (): {
	lines: {entries: LogEntry[]; moment: number} | null;
	board: Window | null;
	open: (destination: LogDestination) => void;
} => {
	const [board] = useState<Window | null>(() => window.opener ?? null);
	const [lines, setLines] = useState<LogLinesMessage | null>(null);

	useEffect(() => {
		if (!board) return;

		const say = (message: LogWindowMessage) =>
			board.postMessage(message, window.location.origin);

		const onMessage = (event: MessageEvent) => {
			if (!isFrom(event, board)) return;

			const message = parseLogLinesMessage(event.data);
			if (message) setLines(message);
		};

		const onPageHide = () => say({type: 'epiq-log:closed'});

		window.addEventListener('message', onMessage);
		window.addEventListener('pagehide', onPageHide);
		say({type: 'epiq-log:ready'});

		return () => {
			window.removeEventListener('message', onMessage);
			window.removeEventListener('pagehide', onPageHide);
		};
	}, [board]);

	const open = useCallback(
		(destination: LogDestination) => {
			board?.postMessage(
				{type: 'epiq-log:open', destination} satisfies LogWindowMessage,
				window.location.origin,
			);
		},
		[board],
	);

	return {lines, board, open};
};
