import {z} from 'zod';
import {failed, Result, succeeded} from '../model/result-types.js';
import {ActionOf, EventMap, StoredEvent} from './event.model.js';

// Bump on any non-backwards-compatible change to the event schema.
export const SCHEMA_VERSION = 1;
// ======================

type Id = string;
type RefId = string;
export type CompositeId = [Id, RefId | null];

/** A line in the log: the envelope, and the payload under its action's name. */
export type PersistedEvent<M extends EventMap = EventMap> = {
	v: 1;
	id: CompositeId;
} & {
	[K in ActionOf<M>]: {
		[P in K]: M[P]['payload'];
	};
}[ActionOf<M>];

const CompositeIdSchema = z.tuple([
	z.string().min(1),
	z.string().min(1).nullable(),
]);

export const PersistedEventSchema = z.looseObject({
	v: z.literal(SCHEMA_VERSION),
	id: CompositeIdSchema,
});

// Stable across every schema version, so ancestry stays readable on a line
// whose payload is not. Only the payload may change shape.
export const PersistedEnvelopeSchema = z.looseObject({
	v: z.number().int().positive(),
	id: CompositeIdSchema,
});

export type PersistedEnvelope = z.infer<typeof PersistedEnvelopeSchema>;

// An own `__proto__` key, which only `JSON.parse` produces. Dropped, as zod's
// `looseObject` does, so every build derives the same order from such a line.
const hasOwnProtoKey = (value: object): boolean =>
	Object.prototype.hasOwnProperty.call(value, '__proto__');

const withoutProtoKey = (value: object): object => {
	const copy: Record<string, unknown> = {};

	for (const key of Object.keys(value)) {
		if (key === '__proto__') continue;

		copy[key] = (value as Record<string, unknown>)[key];
	}

	return copy;
};

/**
 * `PersistedEnvelopeSchema`'s check by hand, returning the value uncopied for speed.
 * Must agree exactly with `parsePersistedEnvelopeStrict` (pinned by a test), or builds diverge.
 */
export const parsePersistedEnvelope = (
	value: unknown,
): Result<PersistedEnvelope> => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return failed('Invalid persisted event envelope: expected an object');
	}

	const {v, id} = value as {v?: unknown; id?: unknown};

	// Safe, not merely integral, matching zod's `.int()`.
	if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) {
		return failed('Invalid persisted event envelope: v');
	}

	if (!Array.isArray(id) || id.length !== 2) {
		return failed('Invalid persisted event envelope: id');
	}

	const [eventId, refId] = id as [unknown, unknown];

	if (typeof eventId !== 'string' || eventId.length === 0) {
		return failed('Invalid persisted event envelope: id.0');
	}

	if (refId !== null && (typeof refId !== 'string' || refId.length === 0)) {
		return failed('Invalid persisted event envelope: id.1');
	}

	return succeeded(
		'Parsed persisted event envelope',
		(hasOwnProtoKey(value)
			? withoutProtoKey(value)
			: value) as PersistedEnvelope,
	);
};

/** The same check through zod, for the test that pins the two together. */
export const parsePersistedEnvelopeStrict = (
	value: unknown,
): Result<PersistedEnvelope> => {
	const result = PersistedEnvelopeSchema.safeParse(value);

	if (!result.success) {
		return failed(
			`Invalid persisted event envelope: ${result.error.issues
				.map(issue => issue.path.join('.') || issue.message)
				.join(', ')}`,
		);
	}

	return succeeded('Parsed persisted event envelope', result.data);
};

// Listed one by one: a bump that changes a payload's shape needs a migration first.
const READABLE_SCHEMA_VERSIONS = [1] as const;

// Fails to compile if a version bump forgets to add itself to the list above. So: fail compile time instead of runtime.
const _assertCurrentVersionReadable: typeof SCHEMA_VERSION extends (typeof READABLE_SCHEMA_VERSIONS)[number]
	? true
	: never = true;
void _assertCurrentVersionReadable;

const readableSchemaVersions: ReadonlySet<number> = new Set(
	READABLE_SCHEMA_VERSIONS,
);

// Readability only; an unsupported event is still part of the history.
export const isSupportedSchemaVersion = (version: number): boolean =>
	readableSchemaVersions.has(version);

export const parsePersistedEvent = <M extends EventMap = EventMap>(
	value: unknown,
): Result<PersistedEvent<M>> => {
	const result = PersistedEventSchema.safeParse(value);

	if (!result.success) {
		return failed(
			`Invalid persisted event: ${result.error.issues
				.map(issue => issue.path.join('.') || issue.message)
				.join(', ')}`,
		);
	}

	return succeeded('Parsed persisted event', result.data as PersistedEvent<M>);
};

export const toPersistedEvent = <M extends EventMap>(
	event: StoredEvent<M>,
	id: CompositeId,
): Result<PersistedEvent<M>> => {
	const candidate = {
		[event.action]: event.payload,
		v: SCHEMA_VERSION,
		id,
	};

	return parsePersistedEvent<M>(candidate);
};
