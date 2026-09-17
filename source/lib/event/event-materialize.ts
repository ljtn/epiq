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
 * A precondition failure: the event lost a race, or names state this replay
 * never applied — the ordinary result of a merge, or of skipping an action
 * this build does not know. Replay skips these so it converges; failing the
 * whole boot instead means one concurrent edit can leave state that never
 * opens again, for whoever's build understands the most.
 *
 * Still a failure, so a live write rejects it: there the precondition is the
 * answer the caller asked for.
 */
export type ConvergenceFail = ReturnFail & {convergence: true};

export const materializeSkip = (
	msg: string,
	event: Identified,
): ConvergenceFail => ({...materializeFail(msg, event), convergence: true});

export const isConvergenceFail = (result: Result): boolean =>
	isFail(result) && (result as Partial<ConvergenceFail>).convergence === true;

/**
 * Splits replay results into a log that is actually broken and events that
 * merely lost. Every replay path aborts on the first and skips the second.
 */
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
 * Applies events through the catalog's handlers, with the guards every
 * product needs and none of them should have to write: an unknown action
 * fails, anything ahead of genesis or a second genesis is a convergence skip,
 * and a handler that throws is fenced into a skip rather than taking the
 * process down on load.
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

		// Anything ordered ahead of genesis — a forged root, or an id that does
		// not decode and so sorts before every real ULID — reaches its handler
		// with no state to read. Replay is total: this is a precondition the
		// replay never met, which is exactly what `materializeSkip` is for.
		if (!catalog.replay.isInitialized() && event.action !== catalog.genesis) {
			return materializeSkip(
				`${event.action} arrived before the state was initialized`,
				event,
			);
		}

		// Genesis initializes state from scratch, so a second one part-way
		// through a replay discards everything applied before it. A forged root
		// carrying a lone genesis satisfies the root filter, and a high ULID
		// anchors it after real history — one such line would empty the state
		// on every clone that pulled it.
		if (event.action === catalog.genesis && batch) {
			if (batch.genesisApplied) {
				return materializeSkip('the state is already initialized', event);
			}

			batch.genesisApplied = true;
		}

		// Last line of defence. Payloads are validated on load and every
		// precondition in a handler is a `materializeSkip`, but a handler this
		// build gets wrong must still not stop the state loading: a throw escapes
		// every `isFail` on the boot path, and the log that caused it is
		// append-only and already in every clone.
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

	// One batch for the whole replay rather than one per event. What the
	// product derives from state is otherwise rebuilt per event, which made
	// replay quadratic: 1.4k events took 905ms, and each doubling of the log
	// quadrupled it.
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
