import {useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
import {
	popoverStyle,
	selectLabelStyle,
	selectTriggerStyle,
} from '../lib/select-style';
import {useDismissOnOutsideClick} from '../lib/use-dismiss-on-outside-click';
import {IconChevronDown} from './IconChevronDown';

type DropdownItem = {
	id: string;
	label: string;
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
}) => {
	const [open, setOpen] = useState(false);
	const ref = useDismissOnOutsideClick(open, () => setOpen(false));

	return (
		<div ref={ref} style={{position: 'relative'}}>
			<button
				type="button"
				data-testid={testId}
				onClick={() => setOpen(value => !value)}
				aria-haspopup="listbox"
				aria-expanded={open}
				title={value?.label}
				style={{
					...selectTriggerStyle(GUI_THEME.primary, false),
					width: TRIGGER_WIDTH,
					// The header's size, not the scrubber's: this names the whole board.
					fontSize: 12,
					padding: '5px 8px 5px 10px',
				}}
			>
				<span style={selectLabelStyle}>{value?.label ?? placeholder}</span>
				<span style={{display: 'inline-flex', flexShrink: 0}}>
					<IconChevronDown size={14} />
				</span>
			</button>

			{open && items.length > 0 ? (
				<div
					role="listbox"
					style={{...popoverStyle, gap: 2, padding: 6, minWidth: TRIGGER_WIDTH}}
				>
					{items.map(item => {
						const selected = item.id === value?.id;

						return (
							<button
								key={item.id}
								type="button"
								role="option"
								aria-selected={selected}
								data-testid={testId ? `${testId}-option` : undefined}
								onClick={() => {
									setOpen(false);
									onSelect(item.id);
								}}
								style={{
									width: '100%',
									display: 'flex',
									justifyContent: 'space-between',
									alignItems: 'center',
									gap: 12,
									border: 'none',
									background: selected ? GUI_THEME.line : 'transparent',
									color: selected ? GUI_THEME.accent : GUI_THEME.primary,
									fontFamily: 'inherit',
									fontSize: 11,
									textAlign: 'left',
									padding: '8px 10px',
									borderRadius: 6,
									cursor: 'pointer',
								}}
							>
								<span>{item.label}</span>
								{selected ? <span>✓</span> : null}
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
};
