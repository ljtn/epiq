// Switching board rebuilds the socket, so callers holding the ref can reach it
// while it is still CONNECTING. `WebSocket.send` throws in that state, and an
// uncaught throw inside a React effect unmounts the tree — a blank page.
//
// Queued rather than dropped: the sends that land in this window are the ones
// that populate the board just switched to, so dropping them would trade a
// crash for an empty column.
const pending = new WeakMap<WebSocket, string[]>();

export const sendSocketJson = (socket: WebSocket | null, data: unknown) => {
	if (!socket) return;

	const message = JSON.stringify(data);

	if (socket.readyState === WebSocket.OPEN) {
		socket.send(message);
		return;
	}

	// Closing or closed: nothing to wait for, and this socket is being replaced.
	if (socket.readyState !== WebSocket.CONNECTING) return;

	const queued = pending.get(socket);

	if (queued) {
		queued.push(message);
		return;
	}

	pending.set(socket, [message]);

	socket.addEventListener(
		'open',
		() => {
			for (const queuedMessage of pending.get(socket) ?? []) {
				socket.send(queuedMessage);
			}

			pending.delete(socket);
		},
		{once: true},
	);
};
