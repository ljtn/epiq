// `WebSocket.send` throws while CONNECTING, which would blank the page from an
// effect; sends are queued instead, since they populate the board.
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
