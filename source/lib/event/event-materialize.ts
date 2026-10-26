import {logger} from '../../logger.js';
import {failed, isFail, Result, ReturnFail} from '../model/result-types.js';
import {EventCatalog} from './event-catalog.js';
import {ActionOf, Event, EventMap, MaterializeResult} from './event.model.js';

export type MaterializeResults<
	M extends EventMap,
	T extends readonly Event<M>[],
> = {
	[K in keyof T]: T[K] extends Event<M, infer A>
		? MaterializeResult<M, A>
		: never;
};

type Identified = {action: string; id: string};

export const materializeFail = (msg: string, event: Identified): ReturnFail =>
	failed(
		`${
			event.action.split('.').join(' ') + ' failed, ' + msg.toLowerCase()
		}. Evt id: ${event.id}`,
	);

/**
 * A precondition failure: the event lost a race or names unapplied state.
 * Replay skips it to converge; a live write still fails on it.
 */
export type ConvergenceFail = ReturnFail & {convergence: true};

export const materializeSkip = (
	msg: string,
	event: Identified,
): ConvergenceFail => ({...materializeFail(msg, event), convergence: true});

export const isConvergenceFail = (result: Result): boolean =>
	isFail(result) && (result as Partial<ConvergenceFail>).convergence === true;

/** Splits replay results into a broken log (abort) and events that merely lost (skip). */
export const partitionMaterializeResults = (
	results: readonly Result[],
): {fatal: ReturnFail[]; skipped: ReturnFail[]} => {
	const failures = results.filter(isFail);

	return {
		fatal: failures.filter(failure => !isConvergenceFail(failure)),
		skipped: failures.filter(isConvergenceFail),
	};
};

export const logSkippedEvents = (skipped: readonly ReturnFail[]): void => {
	if (skipped.length === 0) return;

	logger.info(
		`Skipped ${
			skipped.length
		} event(s) that could not be applied to this state: ${skipped
			.map(failure => failure.message)
			.join('; ')}`,
	);
};

// The id is the whole of an event's identity; a display name is the product's
// to hold, and is absent here by design.
const validateActor = (
	event: Identified & {userId: string},
): ReturnFail | null =>
	event.userId?.length
		? null
		: materializeFail('Invalid user ID format', event);

/**
 * Applies events through the catalog's handlers: an unknown action fails;
 * anything before genesis, a second genesis, or a throwing handler is skipped.
 */
export const createMaterializer = <M extends EventMap>(
	catalog: EventCatalog<M>,
) => {
	// Only the replay's first genesis counts; per batch because state stays
	// initialized between replays.
	let batch: {genesisApplied: boolean} | null = null;

	function materialize<A extends ActionOf<M>>(
		event: Event<M, A>,
		bypassLogging = false,
	): MaterializeResult<M, A> {
		// Unknown actions are filtered at load time; this guards any other path
		// so a foreign event yields a failed Result instead of a crash.
		const handler = catalog.apply[event.action];
		if (!handler) {
			return failed(
				`Unknown event action "${event.action}", likely created by a newer epiq version. Evt id: ${event.id}`,
			);
		}

		// Anything ordered before genesis has no state to read: a convergence skip.
		if (!catalog.replay.isInitialized() && event.action !== catalog.genesis) {
			return materializeSkip(
				`${event.action} arrived before the state was initialized`,
				event,
			);
		}

		// A second genesis mid-replay would wipe the state; a forged root could carry one.
		if (event.action === catalog.genesis && batch) {
			if (batch.genesisApplied) {
				return materializeSkip('the state is already initialized', event);
			}

			batch.genesisApplied = true;
		}

		// A throwing handler is skipped: the line is already in every clone.
		let result: MaterializeResult<M, A>;
		try {
			result = handler(event);
		} catch (error) {
			return materializeSkip(
				`threw while materializing (${
					error instanceof Error ? error.message : String(error)
				})`,
				event,
			);
		}

		if (isFail(result)) return result;

		const actorFail = validateActor(event);
		if (actorFail) return actorFail;

		const afterFail = catalog.replay.afterApply(event, {
			batched: batch !== null,
			bypassLogging,
		});
		if (afterFail) return afterFail;

		return result;
	}

	// One batch for the whole replay; per-event batches make replay quadratic.
	const materializeAll = <const T extends readonly Event<M>[]>(
		events: T,
	): MaterializeResults<M, T> => {
		const result = catalog.replay.batch(() => {
			// Nested calls join the outer batch.
			const owned = batch === null;
			if (owned) batch = {genesisApplied: false};

			let flushed = false;

			try {
				const results = events.map(event =>
					materialize(event),
				) as MaterializeResults<M, T>;

				if (owned) {
					flushed = true;
					const flushFail = catalog.replay.flush();
					if (flushFail) return events.map(() => flushFail) as typeof results;
				}

				return results;
			} finally {
				if (owned) {
					batch = null;
					if (!flushed) catalog.replay.flush();
				}
			}
		});

		// A failed batch leaves the events applied to the base state either way;
		// the caller reads the per-event results to decide what to do about it.
		return isFail(result)
			? (events.map(() => failed(result.message)) as MaterializeResults<M, T>)
			: result.value;
	};

	return {materialize, materializeAll};
};

export type Materializer<M extends EventMap> = ReturnType<
	typeof createMaterializer<M>
>;
