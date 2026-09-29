import {GUI_THEME} from '../lib/gui-theme';
import {Menu, MenuItem} from './Menu';

type DropdownItem = {
	id: string;
	label: string;
	// What the list says about an item beside its name, dim and to the right —
	// the boards' issue counts. Not on the trigger, which is sized to the name.
	hint?: string;
};

// Fixed, not sized to its label, so switching boards does not resize the
// trigger under the pointer; a title too long for it is clipped, and the open
// list spells it out in full.
const TRIGGER_WIDTH = 200;

export const Dropdown = ({
	value,
	items,
	placeholder = 'Select...',
	onSelect,
	testId,
}: {
	value?: DropdownItem | null;
	items: DropdownItem[];
	placeholder?: string;
	onSelect: (id: string) => void;
	// Handles for the browser tests. The trigger's text is the current
	// selection, so selecting by text cannot address it across a change.
	testId?: string;
}) => (
	// Portalled: this sits in the topbar, which clips its children.
	<Menu
		portal
		label={value?.label ?? placeholder}
		title={value?.label}
		width={TRIGGER_WIDTH}
		testId={testId}
		chevronSize={14}
		// The header's size, not the scrubber's: this names the whole board.
		triggerStyle={{fontSize: 12, padding: '5px 8px 5px 10px'}}
	>
		{close =>
			items.map(item => {
				const selected = item.id === value?.id;

				return (
					<MenuItem
						key={item.id}
						role="option"
						selected={selected}
						testId={testId ? `${testId}-option` : undefined}
						onSelect={() => {
							close();
							onSelect(item.id);
						}}
						style={{gap: 12, padding: '8px 10px'}}
					>
						<span>{item.label}</span>
						<span
							style={{display: 'inline-flex', alignItems: 'center', gap: 10}}
						>
							{item.hint ? (
								<span style={{color: GUI_THEME.dim}}>{item.hint}</span>
							) : null}
							{/* On every row, so the hints stay in line with the tick's. */}
							<span
								aria-hidden={!selected}
								style={{width: '1ch', textAlign: 'right'}}
							>
								{selected ? '✓' : ''}
							</span>
						</span>
					</MenuItem>
				);
			})
		}
	</Menu>
);
