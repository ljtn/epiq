import {useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {GUI_THEME, UI_FONT} from '../lib/gui-theme';
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
}) => {
	const [open, setOpen] = useState(false);
	// The list is no longer inside the trigger, so `aria-haspopup` alone leaves
	// a reader with a control that says a list exists and no way to reach it.
	const listId = useId();
	// The list is portalled out to the body: this sits in the topbar, and the
	// topbar is a Panel, which clips its children to contain its own glow — a
	// list in flow there is cut off at the bar's edge. Named as inside so a
	// click on an option is not read as a click away.
	const listRef = useRef<HTMLDivElement | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const ref = useDismissOnOutsideClick(open, () => setOpen(false), [listRef]);
	const [anchor, setAnchor] = useState<{left: number; top: number} | null>(
		null,
	);

	useLayoutEffect(() => {
		if (!open) return;

		const place = () => {
			const box = triggerRef.current?.getBoundingClientRect();
			if (!box) return;

			setAnchor({left: box.left, top: box.bottom + 6});
		};

		place();
		window.addEventListener('resize', place);
		window.addEventListener('scroll', place, true);

		return () => {
			window.removeEventListener('resize', place);
			window.removeEventListener('scroll', place, true);
		};
	}, [open]);

	return (
		<div ref={ref} style={{position: 'relative'}}>
			<button
				ref={triggerRef}
				type="button"
				data-testid={testId}
				onClick={() => setOpen(value => !value)}
				aria-haspopup="listbox"
				aria-controls={open ? listId : undefined}
				aria-expanded={open}
				title={value?.label}
				style={{
					...selectTriggerStyle(GUI_THEME.chromePrimary, false),
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

			{open && items.length > 0 && anchor
				? createPortal(
						<div
							ref={listRef}
							id={listId}
							role="listbox"
							style={{
								...popoverStyle,
								position: 'fixed',
								left: anchor.left,
								top: anchor.top,
								marginTop: 0,
								// Stated, not inherited: the body is what a portal inherits
								// from, and the app's face is set on the tree below it.
								fontFamily: UI_FONT,
								gap: 2,
								padding: 6,
								minWidth: TRIGGER_WIDTH,
							}}
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
										<span
											style={{
												display: 'inline-flex',
												alignItems: 'center',
												gap: 10,
											}}
										>
											{item.hint ? (
												<span style={{color: GUI_THEME.dim}}>{item.hint}</span>
											) : null}
											{/* Kept on every row, empty on all but one: a tick that
											    takes its width only where it is shown pushes the
											    hint beside it out of line with the rows below. */}
											<span
												aria-hidden={!selected}
												style={{width: '1ch', textAlign: 'right'}}
											>
												{selected ? '✓' : ''}
											</span>
										</span>
									</button>
								);
							})}
						</div>,
						document.body,
				  )
				: null}
		</div>
	);
};
