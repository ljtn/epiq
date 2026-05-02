import {setCmdInput} from '../state/cmd.state.js';

const MAX_COMMAND_INPUT_LENGTH = 500;

const sanitizeCommandInputSequence = (sequence: string): string =>
	sequence
		.replace(/[\r\n]/g, '')
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

export const appendCommandInput = (sequence: string): void => {
	const cleanSequence = sanitizeCommandInputSequence(sequence);
	if (!cleanSequence) return;

	setCmdInput(previous => {
		const next = previous + cleanSequence;
		return next.slice(0, MAX_COMMAND_INPUT_LENGTH);
	});
};
