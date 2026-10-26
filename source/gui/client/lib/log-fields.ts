// Which fields a log line shows, kept per browser. Carried as a class on the
// pane, so toggling one never re-renders the rows.

import {usePersistedFlag} from './use-persisted-flag';

export type LogField = 'time' | 'actor' | 'kind' | 'diff' | 'label';

export type LogFields = Readonly<Record<LogField, boolean>>;

export const ALL_LOG_FIELDS: LogFields = {
	time: true,
	actor: true,
	kind: true,
	diff: true,
	label: true,
};

// In the order the row reads; see EVENT_LOG_STYLES.
export const LOG_FIELD_ORDER: readonly LogField[] = [
	'time',
	'kind',
	'actor',
	'diff',
	'label',
];

export const LOG_FIELD_NAMES: Readonly<Record<LogField, string>> = {
	time: 'Time',
	actor: 'Actor',
	kind: 'Type',
	diff: 'Diff',
	label: 'Label',
};

const storageKeyFor = (field: LogField): string => `epiq.eventLog.${field}`;

// The class the pane wears for a field that is off. Named for what is
// missing, so the default pane wears none of them.
export const logFieldOffClass = (field: LogField): string =>
	`epiq-log--no-${field}`;

export const logPaneClassName = (fields: LogFields): string =>
	LOG_FIELD_ORDER.filter(field => !fields[field])
		.map(logFieldOffClass)
		.join(' ');

export const useLogFields = (): {
	fields: LogFields;
	setField: (field: LogField, on: boolean) => void;
} => {
	const [time, setTime] = usePersistedFlag(storageKeyFor('time'), true);
	const [actor, setActor] = usePersistedFlag(storageKeyFor('actor'), true);
	const [kind, setKind] = usePersistedFlag(storageKeyFor('kind'), true);
	const [diff, setDiff] = usePersistedFlag(storageKeyFor('diff'), true);
	const [label, setLabel] = usePersistedFlag(storageKeyFor('label'), true);

	const setters: Record<LogField, (on: boolean) => void> = {
		time: setTime,
		actor: setActor,
		kind: setKind,
		diff: setDiff,
		label: setLabel,
	};

	return {
		fields: {time, actor, kind, diff, label},
		setField: (field, on) => setters[field](on),
	};
};
