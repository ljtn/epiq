import {decodeTime} from 'ulid';
import {failed, Result, succeeded} from '../model/result-types.js';
import {AppEvent} from './event.model.js';

export const safeDateFromUlid = (id: string): Result<Date> => {
	try {
		return succeeded('Decoded date', new Date(decodeTime(id)));
	} catch (error) {
		return failed('Decoding failed + ' + (error as Error).message);
	}
};

export const getEventTime = (event: AppEvent | undefined): number | null => {
	if (!event?.id) return null;

	try {
		return decodeTime(event.id);
	} catch {
		return null;
	}
};
