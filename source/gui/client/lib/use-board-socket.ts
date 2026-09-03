// The board's connection to its server: opening it, losing it, getting it back,
// and sending on it. Everything about the transport and nothing about what the
// frames mean — the caller is handed each message and decides that for itself.
//
// The split is deliberate. Moving the message handling in here as well would
// have meant passing a dozen state setters into a hook, which relocates the
// coupling rather than removing it.

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createMutationGate} from './mutation-gate';
import {reconnectDelayMs} from './reconnect';
import {sendSocketJson} from './socket-send';

// What a message handler is allowed to do with the connection the message
// arrived on. Stable for the life of the hook, so a handler stored in a ref
// cannot end up holding a stale one.
export type BoardSocketActions = {
	// Goes through the mutation gate: broadcasts are held until this client's
	// own change has been answered, so an optimistic update is not reverted by
	// state that left the server before it landed.
	send: (type: string, payload: unknown) => void;
	// A frame the gate has no interest in — a read, or a reply of our own.
	sendRaw: (message: unknown) => void;
	requestState: () => void;
	// Whether one of this client's mutations is still unanswered.
	holdsState: () => boolean;
};

export type BoardSocket = BoardSocketActions & {
	connected: boolean;
	// Bumped per socket, not per connection state: a socket the effect replaces
	// never reports a disconnect, so `connected` alone cannot tell a reader that
	// its outstanding requests died with the old one.
	socketEpoch: number;
	// True once the automatic attempts are spent, so the topbar can offer the
	// button rather than retrying behind the reader's back forever.
	reconnectExhausted: boolean;
	reconnectNow: () => void;
};

export const useBoardSocket = ({
	boardId,
	onMessage,
}: {
	boardId: string | undefined;
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

	// Held in a ref rather than listed as a dependency: the caller re-creates
	// its handler on every render, and a dependency would tear the socket down
	// and open a new one just as often.
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

	const actions = useMemo(
		() => ({send, sendRaw, requestState, holdsState}),
		[send, sendRaw, requestState, holdsState],
	);

	const reconnectNow = useCallback(() => {
		reconnectAttempts.current = 0;
		setReconnectExhausted(false);
		setReconnectTick(tick => tick + 1);
	}, []);

	useEffect(() => {
		const socket = new WebSocket(
			`ws://${window.location.host}/ws${boardId ? `?boardId=${boardId}` : ''}`,
		);

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

			// A socket this effect is replacing is not a lost connection: the next
			// one is already opening. Reporting it would flash the whole offline
			// treatment on every navigation, which re-runs this effect.
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

			onMessageRef.current(message, actions);
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
		// `reconnectTick` is what re-runs this after a drop. `actions` and `gate`
		// are stable for the life of the hook.
	}, [boardId, reconnectTick, actions, gate]);

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
