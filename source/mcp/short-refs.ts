import {AppState} from '../lib/model/app-state.model.js';
import {failed, isFail, Result, succeeded} from '../lib/model/result-types.js';
import {getSafeState} from '../lib/state/state.js';
import {NODE_REF_LENGTH, nodeRef} from '../lib/utils/node-ref.js';

// Agents name nodes by their 7-character ref; the log keeps full ids. A ref
// shared by two ids is never guessed: an input fails, an output stays full.

type RefIndex = {byRef: Map<string, string[]>; goals: Set<string>};

const indexRefs = (state: AppState): RefIndex => {
	const byRef = new Map<string, string[]>();
	const records = [
		state.nodes,
		state.contributors,
		state.tags,
		state.goals,
		state.comments,
		state.attachments,
	];

	for (const record of records) {
		for (const id of Object.keys(record ?? {})) {
			const ref = nodeRef(id);
			const ids = byRef.get(ref);
			if (!ids) byRef.set(ref, [id]);
			else if (!ids.includes(id)) ids.push(id);
		}
	}

	return {byRef, goals: new Set(Object.keys(state.goals ?? {}))};
};

const currentIndex = (): RefIndex | null => {
	const state = getSafeState();
	return isFail(state) ? null : indexRefs(state.value);
};

// `goal` takes a goal's name or its id.
const GOAL_KEY = 'goal';

const isIdKey = (key: string) =>
	/(Id|Ids)$/.test(key) ||
	key === 'sibling' ||
	key === 'idOrRef' ||
	key === GOAL_KEY;

const isRefShaped = (value: unknown): value is string =>
	typeof value === 'string' && value.length === NODE_REF_LENGTH;

export const hasRefInput = (input: unknown): boolean => {
	if (Array.isArray(input)) return input.some(hasRefInput);
	if (!input || typeof input !== 'object') return false;

	return Object.entries(input).some(([key, value]) =>
		isIdKey(key)
			? isRefShaped(value) || (Array.isArray(value) && value.some(isRefShaped))
			: hasRefInput(value),
	);
};

// A ref nothing matches passes through, so the tool says what wasn't found.
const expandOne = (
	index: RefIndex,
	value: string,
	goalOnly = false,
): Result<string> => {
	const ids = (index.byRef.get(value.toUpperCase()) ?? []).filter(
		id => !goalOnly || index.goals.has(id),
	);
	if (ids.length > 1) {
		return failed(`Ref ${value} is ambiguous: use one of ${ids.join(', ')}`);
	}

	return succeeded('Resolved ref', ids[0] ?? value);
};

const expandAll = (
	values: unknown[],
	expand: (value: unknown) => Result<unknown>,
): Result<unknown[]> => {
	const out: unknown[] = [];
	for (const value of values) {
		const result = expand(value);
		if (isFail(result)) return result;
		out.push(result.value);
	}

	return succeeded('Expanded', out);
};

const expandId = (index: RefIndex, value: unknown): Result<unknown> =>
	isRefShaped(value)
		? expandOne(index, value)
		: Array.isArray(value)
		? expandAll(value, item => expandId(index, item))
		: succeeded('Kept', value);

const expandWith = (index: RefIndex, input: unknown): Result<unknown> => {
	if (Array.isArray(input)) {
		return expandAll(input, item => expandWith(index, item));
	}

	if (!input || typeof input !== 'object') return succeeded('Kept', input);

	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input)) {
		const result =
			key === GOAL_KEY && isRefShaped(value)
				? expandOne(index, value, true)
				: isIdKey(key)
				? expandId(index, value)
				: expandWith(index, value);
		if (isFail(result)) return result;
		out[key] = result.value;
	}

	return succeeded('Expanded', out);
};

/** Every ref in an id field becomes its full id, against the booted state. */
export const expandRefs = <I>(input: I): Result<I> => {
	const index = currentIndex();
	if (!index) return succeeded('No state to resolve against', input);

	return expandWith(index, input) as Result<I>;
};

const shortenWith = (index: RefIndex, value: unknown): unknown => {
	if (typeof value === 'string') {
		const ids = index.byRef.get(nodeRef(value));
		return ids?.length === 1 && ids[0] === value ? nodeRef(value) : value;
	}

	if (Array.isArray(value)) return value.map(item => shortenWith(index, item));
	if (!value || typeof value !== 'object') return value;

	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value)) {
		out[shortenWith(index, key) as string] = shortenWith(index, item);
	}

	// `ref` beside an id it now equals says nothing twice.
	if (typeof out['id'] === 'string' && out['id'] === out['ref']) {
		delete out['ref'];
	}

	return out;
};

/** Every full id with a ref of its own reads as that ref. */
export const shortenIds = <T>(value: T): T => {
	const index = currentIndex();
	return index ? (shortenWith(index, value) as T) : value;
};
