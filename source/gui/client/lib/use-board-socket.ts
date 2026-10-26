// The board's connection to its server: open, lose, regain and send. What the
// frames mean is the caller's.

import {useCallback, useEffect, useRef, useState} from 'react';
import {createMutationGate} from './mutation-gate';
import {reconnectDelayMs} from './reconnect';
import {sendSocketJson} from './socket-send';

// What a handler may do with the connection; stable for the hook's life.
export type BoardSocketActions = {
	// Through the mutation gate, so an optimistic update isn't reverted.
	send: (type: string, payload: unknown) => void;
	// A frame the gate has no interest in — a read, or a reply of our own.
	sendRaw: (message: unknown) => void;
	requestState: () => void;
	// Whether one of this client's mutations is still unanswered.
	holdsState: () => boolean;
};

export type BoardSocket = BoardSocketActions & {
	connected: boolean;
	// Bumped per socket: a replaced socket never reports a disconnect.
	socketEpoch: number;
	// True once the automatic attempts are spent, so the topbar can offer the
	// button rather than retrying behind the reader's back forever.
	reconnectExhausted: boolean;
	reconnectNow: () => void;
};

/**
 * Whether an answer for one board may still be acted on; one socket lasts the
 * session, so a reply can arrive after a board switch. No board: never stale.
 */
export const answersBoardOnScreen = (
	answeredFor: string | undefined,
	onScreen: string | null | undefined,
): boolean => answeredFor === undefined || answeredFor === onScreen;

// The page's own scheme: a page served over https may not open an insecure
// socket, and the board would render empty.
export const boardSocketUrl = (location: {
	protocol: string;
	host: string;
}): string =>
	`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

export const useBoardSocket = ({
	onMessage,
}: {
	onMessage: (message: any, socket: BoardSocketActions) => void;
}): BoardSocket => {
	const socketRef = useRef<WebSocket | null>(null);
	const [connected, setConnected] = useState(false);
	const [socketEpoch, setSocketEpoch] = useState(0);
	const [reconnectTick, setReconnectTick] = useState(0);
	const [reconnectExhausted, setReconnectExhausted] = useState(false);
	const reconnectAttempts = useRef(0);
	const reconnectTimer = useRef<number | null>(null);
	const [gate] = useState(createMutationGate);

	// A ref, so re-creating the handler never reopens the socket.
	const onMessageRef = useRef(onMessage);
	onMessageRef.current = onMessage;

	const sendRaw = useCallback((message: unknown) => {
		sendSocketJson(socketRef.current, message);
	}, []);

	const send = useCallback(
		(type: string, payload: unknown) => {
			gate.sent(type);
			sendSocketJson(socketRef.current, {type, payload});
		},
		[gate],
	);

	const requestState = useCallback(
		() => sendRaw({type: 'state:get'}),
		[sendRaw],
	);

	const holdsState = useCallback(() => gate.holdsState(), [gate]);

	// A ref: a useMemo may be discarded, tearing down a live socket.
	const actionsRef = useRef<BoardSocketActions>({
		send,
		sendRaw,
		requestState,
		holdsState,
	});
	actionsRef.current = {send, sendRaw, requestState, holdsState};

	const reconnectNow = useCallback(() => {
		reconnectAttempts.current = 0;
		setReconnectExhausted(false);
		setReconnectTick(tick => tick + 1);
	}, []);

	// One socket for the session, whichever board is on screen, so no reply in
	// flight is lost to a board switch.
	useEffect(() => {
		const socket = new WebSocket(boardSocketUrl(window.location));

		socketRef.current = socket;
		// Distinguishes a socket the effect is tearing down from one that dropped
		// on its own; only the latter is worth reconnecting.
		let replaced = false;

		socket.addEventListener('open', () => {
			setConnected(true);
			setSocketEpoch(epoch => epoch + 1);
			reconnectAttempts.current = 0;
			setReconnectExhausted(false);
			gate.reset();
			sendSocketJson(socket, {type: 'state:get'});
			// History is not requested here: the scrubber owns the scope and drives
			// that fetch itself, so asking here would ignore its stored selection.
		});

		socket.addEventListener('close', () => {
			if (socketRef.current === socket) {
				socketRef.current = null;
			}

			// A replaced socket is not a lost connection; no offline flash.
			if (replaced) return;

			setConnected(false);
			gate.reset();

			// Without this the board is dead until a manual reload: nothing arrives
			// and nothing is sent, while the controls carry on as if they worked.
			const delay = reconnectDelayMs(reconnectAttempts.current);

			if (delay === null) {
				setReconnectExhausted(true);
				return;
			}

			reconnectAttempts.current += 1;
			reconnectTimer.current = window.setTimeout(
				() => setReconnectTick(tick => tick + 1),
				delay,
			);
		});

		socket.addEventListener('message', event => {
			const message = JSON.parse(event.data);

			// Before the handler, which asks `holdsState()` to decide whether a
			// broadcast may be applied.
			gate.received(message.type);

			onMessageRef.current(message, actionsRef.current);
		});

		return () => {
			replaced = true;

			if (reconnectTimer.current !== null) {
				clearTimeout(reconnectTimer.current);
				reconnectTimer.current = null;
			}

			if (socketRef.current === socket) {
				socketRef.current = null;
			}

			socket.close();
		};
		// `reconnectTick` is what re-runs this after a drop. `gate` is stable for
		// the life of the hook.
	}, [reconnectTick, gate]);

	return {
		connected,
		socketEpoch,
		reconnectExhausted,
		reconnectNow,
		send,
		sendRaw,
		requestState,
		holdsState,
	};
};
