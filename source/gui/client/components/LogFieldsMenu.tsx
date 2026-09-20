// The log's field boxes, folded into one control for a pane too narrow to
// stand them in a row. Same boxes, same order, same titles — the only thing
// that changes is whether they are read across the header or down a popover.

import {useState} from 'react';
import {
	LOG_FIELD_NAMES,
	LOG_FIELD_ORDER,
	LogField,
	LogFields,
} from '../lib/log-fields';
import {GUI_THEME} from '../lib/gui-theme';
import {
	popoverStyle,
	selectLabelStyle,
	selectTriggerStyle,
} from '../lib/select-style';
import {useDismissOnOutsideClick} from '../lib/use-dismiss-on-outside-click';
import {Checkbox} from './Checkbox';
import {IconChevronDown} from './IconChevronDown';

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
}) => {
	const [open, setOpen] = useState(false);
	const ref = useDismissOnOutsideClick(open, () => setOpen(false));

	// Something is hidden, which the row said by itself and a shut popover
	// cannot. The trigger carries it rather than a count: which ones are off is
	// a question the popover answers, and it is one click away.
	const anyOff = LOG_FIELD_ORDER.some(field => !fields[field]);

	return (
		<div ref={ref} style={{position: 'relative', flexShrink: 0}}>
			<button
				type="button"
				data-testid="log-fields-menu"
				onClick={() => setOpen(value => !value)}
				aria-haspopup="true"
				aria-expanded={open}
				title="Choose what each line shows"
				style={selectTriggerStyle(
					anyOff ? GUI_THEME.accent : GUI_THEME.dim,
					false,
				)}
			>
				<span style={selectLabelStyle}>Fields</span>
				<span style={{display: 'inline-flex', flexShrink: 0}}>
					<IconChevronDown size={14} />
				</span>
			</button>

			{open && (
				<div style={popoverStyle}>
					{LOG_FIELD_ORDER.map(field => (
						<LogFieldBox
							key={field}
							field={field}
							fields={fields}
							spoken={field === spokenField}
							onChangeField={onChangeField}
						/>
					))}
				</div>
			)}
		</div>
	);
};
