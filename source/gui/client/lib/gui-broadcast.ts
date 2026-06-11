import {WebSocket} from 'ws';

const sockets = new Set<WebSocket>();

export const registerGuiSocket = (socket: WebSocket) => {
	sockets.add(socket);

	socket.on('close', () => {
		sockets.delete(socket);
	});

	socket.on('error', () => {
		sockets.delete(socket);
	});
};

export const broadcastGuiMessage = (body: {
	type: 'state' | 'sync-status' | 'issue:created' | 'failed';
	payload: unknown;
}) => {
	const json = JSON.stringify(body);

	for (const socket of sockets) {
		if (socket.readyState === WebSocket.OPEN) {
			socket.send(json);
		}
	}
};
