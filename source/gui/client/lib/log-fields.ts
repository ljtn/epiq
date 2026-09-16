// What a log line shows: its clock, who did it, the dot for its kind, and the
// line itself. Each can be left out from the panel's header, and the choice is
// kept per browser. Everything is on until somebody turns it off.
//
// The layout of a row is CSS, so a choice is carried to the rows as a class on
// the pane rather than as props to hundreds of them: turning a column off is
// one class toggling, not the whole column re-rendering.

import {usePersistedFlag} from './use-persisted-flag';

export type LogField = 'time' | 'actor' | 'kind' | 'changes' | 'label';

export type LogFields = Readonly<Record<LogField, boolean>>;

export const ALL_LOG_FIELDS: LogFields = {
	time: true,
	actor: true,
	kind: true,
	changes: true,
	label: true,
};

// In the order the row reads, which is the order the header lists them.
export const LOG_FIELD_ORDER: readonly LogField[] = [
	'time',
	'actor',
	'kind',
	'changes',
	'label',
];

export const LOG_FIELD_NAMES: Readonly<Record<LogField, string>> = {
	time: 'Time',
	actor: 'Actor',
	kind: 'Type',
	changes: 'Changes',
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
	const [changes, setChanges] = usePersistedFlag(
		storageKeyFor('changes'),
		true,
	);
	const [label, setLabel] = usePersistedFlag(storageKeyFor('label'), true);

	const setters: Record<LogField, (on: boolean) => void> = {
		time: setTime,
		actor: setActor,
		kind: setKind,
		changes: setChanges,
		label: setLabel,
	};

	return {
		fields: {time, actor, kind, changes, label},
		setField: (field, on) => setters[field](on),
	};
};
