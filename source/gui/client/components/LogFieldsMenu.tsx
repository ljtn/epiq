// The log's field boxes, folded into one control for a pane too narrow to
// stand them in a row. Same boxes, same order, same titles — the only thing
// that changes is whether they are read across the header or down a popover.

import {
	LOG_FIELD_NAMES,
	LOG_FIELD_ORDER,
	LogField,
	LogFields,
} from '../lib/log-fields';
import {GUI_THEME} from '../lib/gui-theme';
import {Checkbox} from './Checkbox';
import {Menu, MenuItem} from './Menu';

// One field's box, wherever it is drawn. Both places take it from here so the
// fold cannot drift from the row it stands in for — same tick, same title, and
// the same standing down for the field a lane heading already speaks.
export const LogFieldBox = ({
	field,
	fields,
	spoken,
	onChangeField,
}: {
	field: LogField;
	fields: LogFields;
	spoken: boolean;
	onChangeField: (field: LogField, on: boolean) => void;
}) => (
	<Checkbox
		testId={`log-field-${field}`}
		label={LOG_FIELD_NAMES[field]}
		checked={fields[field] && !spoken}
		disabled={spoken}
		activeColor={GUI_THEME.dim}
		title={
			spoken
				? 'The lane says who'
				: `${fields[field] ? 'Hide' : 'Show'} the ${LOG_FIELD_NAMES[
						field
				  ].toLowerCase()} on each line`
		}
		onChange={on => onChangeField(field, on)}
	/>
);

export const LogFieldsMenu = ({
	fields,
	onChangeField,
	// The field the lane headings already speak for, disabled here as it is in
	// the open row — the fold must not smuggle back a box that stood down.
	spokenField,
}: {
	fields: LogFields;
	onChangeField: (field: LogField, on: boolean) => void;
	spokenField: LogField | null;
}) => (
	<Menu
		label="View options"
		testId="log-fields-menu"
		title="Choose what each line shows"
		chevronSize={14}
		popupRole="group"
	>
		{() =>
			LOG_FIELD_ORDER.map(field => (
				<MenuItem key={field}>
					<LogFieldBox
						field={field}
						fields={fields}
						spoken={field === spokenField}
						onChangeField={onChangeField}
					/>
				</MenuItem>
			))
		}
	</Menu>
);
