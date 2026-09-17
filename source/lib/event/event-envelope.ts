import {z} from 'zod';
import {failed, Result, succeeded} from '../model/result-types.js';
import {ActionOf, EventMap, StoredEvent} from './event.model.js';

// ======================
// Increment this if we make any non-backwards-compatible changes to the event schema, so we can handle old vs new formats in event loading.
// ======================
export const SCHEMA_VERSION = 1;
// ======================

type Id = string;
type RefId = string;
export type CompositeId = [Id, RefId | null];

/**
 * A line in the log: the envelope, and the payload under its action's name.
 */
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

export const parsePersistedEnvelope = (
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

// Versions this build can decode, listed one by one rather than `<=
// SCHEMA_VERSION`: if a bump changes the shape of an existing payload, write
// the migration before adding the version here.
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
