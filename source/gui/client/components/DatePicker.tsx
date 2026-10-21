// A day, picked from a calendar in the board's own colours. The trigger reads
// as the day chosen; the popover holds a month and a year menu, arrows a
// month either way, and the month's grid, which the keyboard walks. Days
// after today cannot be picked.

import React, {useEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {
	dateOfDay,
	dayOf,
	firstOfMonth,
	monthGrid,
	stepDay,
} from '../lib/calendar-day';
import {GUI_THEME, UI_FONT} from '../lib/gui-theme';
import {
	menuRowHoverBackground,
	popoverStyle,
	selectLabelStyle,
	selectTriggerStyle,
} from '../lib/select-style';
import {useDismissOnOutsideClick} from '../lib/use-dismiss-on-outside-click';
import {IconButton, ICON_SIZE} from './IconButton';
import {IconCalendar} from './IconCalendar';
import {IconChevronLeft} from './IconChevronLeft';
import {IconChevronRight} from './IconChevronRight';
import {Menu, MenuItem, usePortalAnchor} from './Menu';

const MONTHS = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec',
];

// The board's history starts no earlier than git's own epoch.
const FIRST_YEAR = 1970;

const CELL = 30;

const WEEKDAYS = [
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday',
];

// Pseudo-classes, which inline styles cannot reach. Scoped to the popover.
const GRID_STYLES = `
	.epiq-date table { border-collapse: collapse; }
	.epiq-date th {
		width: ${CELL}px;
		padding: 0 0 4px;
		font-size: 9px;
		font-weight: normal;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: ${GUI_THEME.dim};
	}
	.epiq-date td { padding: 1px; }
	.epiq-date td button {
		width: ${CELL}px;
		height: ${CELL - 4}px;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: ${GUI_THEME.primary};
		font: inherit;
		font-size: 11px;
		cursor: pointer;
	}
	.epiq-date td button:hover { background: ${menuRowHoverBackground}; }
	.epiq-date td button:focus-visible {
		outline: none;
		background: ${menuRowHoverBackground};
		border-color: ${GUI_THEME.dim2};
	}
	.epiq-date td[data-today] button { color: ${GUI_THEME.accent}; }
	.epiq-date td[data-selected] button {
		border-color: ${GUI_THEME.accent};
		color: ${GUI_THEME.accent};
	}
	.epiq-date td button:disabled {
		color: ${GUI_THEME.dim};
		opacity: 0.35;
		background: transparent;
		cursor: default;
	}
	.epiq-date td[data-outside] { visibility: hidden; }
`;

// One month's days, a roving focus walked by the arrows, Home and End, and
// PageUp and PageDown for a month. A step past either edge of the month shows
// the next one; one past today, or before the first month, stops there.
const DayGrid = ({
	month,
	onMonth,
	selected,
	today,
	onPick,
}: {
	month: Date;
	onMonth: (month: Date) => void;
	selected?: Date;
	today: Date;
	onPick: (day: Date) => void;
}) => {
	const inMonth = (date: Date | undefined) =>
		date !== undefined &&
		date.getFullYear() === month.getFullYear() &&
		date.getMonth() === month.getMonth();
	const [focused, setFocused] = useState<Date>(() =>
		inMonth(selected) ? selected! : inMonth(today) ? today : month,
	);
	// Moved by the keyboard, or just opened: the button then takes focus. A
	// month changed from the menus leaves it where the reader is.
	const pull = useRef(true);
	const gridRef = useRef<HTMLTableElement | null>(null);

	const tabbable = inMonth(focused)
		? focused
		: inMonth(selected)
		? selected!
		: inMonth(today)
		? today
		: month;
	const tabbableDay = dayOf(tabbable);

	// After the commit rather than in it: the popover's ref, which the
	// picker's blur check reads, is attached only once the grid is in.
	useEffect(() => {
		if (!pull.current) return;

		pull.current = false;
		gridRef.current
			?.querySelector<HTMLButtonElement>(`[data-day="${tabbableDay}"] button`)
			?.focus();
	}, [tabbableDay]);

	const first = new Date(FIRST_YEAR, 0, 1);
	const onKeyDown = (event: React.KeyboardEvent) => {
		const step = stepDay(tabbable, event.key);
		if (!step) return;

		event.preventDefault();
		const next = step > today ? today : step < first ? first : step;
		pull.current = true;
		setFocused(next);
		if (!inMonth(next)) onMonth(firstOfMonth(next));
	};

	const weeks = monthGrid(month);
	const todayDay = dayOf(today);
	const selectedDay = selected ? dayOf(selected) : null;

	return (
		<table
			ref={gridRef}
			role="grid"
			aria-label={`${MONTHS[month.getMonth()]} ${month.getFullYear()}`}
			onKeyDown={onKeyDown}
		>
			<thead>
				<tr>
					{WEEKDAYS.map(name => (
						<th key={name} scope="col" abbr={name}>
							{name.slice(0, 2)}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{Array.from({length: 6}, (_, week) => (
					<tr key={week}>
						{weeks.slice(week * 7, week * 7 + 7).map(date => {
							const day = dayOf(date);
							const outside = !inMonth(date);
							const flag = (on: boolean) => (on ? 'true' : undefined);

							return (
								<td
									key={day}
									data-day={day}
									data-outside={flag(outside)}
									data-today={flag(day === todayDay)}
									data-selected={flag(day === selectedDay)}
									aria-selected={outside ? undefined : day === selectedDay}
								>
									{!outside && (
										<button
											type="button"
											tabIndex={day === tabbableDay ? 0 : -1}
											disabled={day > todayDay}
											onClick={() => onPick(date)}
										>
											{date.getDate()}
										</button>
									)}
								</td>
							);
						})}
					</tr>
				))}
			</tbody>
		</table>
	);
};

export const DatePicker = ({
	value,
	onPick,
	open,
	onOpenChange,
	placeholder = 'Pick a date',
	label,
	testId,
	portalInto,
}: {
	// YYYY-MM-DD, or empty for none yet.
	value: string;
	onPick: (day: string) => void;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	placeholder?: string;
	// The trigger's accessible name.
	label: string;
	testId: string;
	// Inside a modal: the panel the popover must stack above. See Menu.
	portalInto?: () => HTMLElement | null;
}) => {
	const selected = dateOfDay(value) ?? undefined;
	const today = new Date();
	const thisMonth = firstOfMonth(today);
	const [month, setMonth] = useState(() => firstOfMonth(selected ?? today));

	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const listRef = useRef<HTMLDivElement | null>(null);
	const close = () => onOpenChange(false);
	const ref = useDismissOnOutsideClick(open, close, [listRef], {
		escape: false,
	});
	const anchor = usePortalAnchor(open, triggerRef, listRef);

	const setOpen = (next: boolean) => {
		// Opens on the chosen day's month, not wherever it was last left.
		if (next) setMonth(firstOfMonth(selected ?? today));
		onOpenChange(next);
	};

	// Escape closes the innermost thing open: a month or year menu claims the
	// key first, and this one keeps it from the panel around the picker.
	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key !== 'Escape' || event.defaultPrevented) return;

		event.preventDefault();
		event.stopPropagation();
		close();
		triggerRef.current?.focus();
	};

	const years = Array.from(
		{length: today.getFullYear() - FIRST_YEAR + 1},
		(_, index) => today.getFullYear() - index,
	);
	const months = MONTHS.slice(
		0,
		month.getFullYear() === today.getFullYear() ? today.getMonth() + 1 : 12,
	);
	// Never past this month: the year menu can land on a later month of it.
	const go = (next: Date) =>
		setMonth(next > thisMonth ? thisMonth : firstOfMonth(next));

	const atStart = month.getFullYear() === FIRST_YEAR && month.getMonth() === 0;
	const atEnd = month.getTime() === thisMonth.getTime();

	const popover = (
		<div
			ref={listRef}
			role="dialog"
			aria-label={label}
			data-testid={`${testId}-calendar`}
			className="epiq-date"
			onKeyDown={onKeyDown}
			style={{
				...popoverStyle,
				gap: 6,
				padding: 8,
				position: 'fixed',
				left: anchor?.left ?? 0,
				top: anchor?.top ?? 0,
				marginTop: 0,
				// A portal inherits from the body, not the app.
				fontFamily: UI_FONT,
				// Placed before it is seen, so it does not flash at the corner;
				// faded rather than hidden, which would refuse the grid its focus.
				opacity: anchor ? 1 : 0,
			}}
		>
			<style>{GRID_STYLES}</style>
			<div style={{display: 'flex', alignItems: 'center', gap: 4}}>
				<Menu
					label={MONTHS[month.getMonth()]}
					testId={`${testId}-month`}
					width={64}
					color={GUI_THEME.primary}
				>
					{closeMenu =>
						months.map((name, index) => (
							<MenuItem
								key={name}
								role="option"
								selected={index === month.getMonth()}
								testId={`${testId}-month-option`}
								onSelect={() => {
									closeMenu();
									go(new Date(month.getFullYear(), index, 1));
								}}
							>
								{name}
							</MenuItem>
						))
					}
				</Menu>
				<Menu
					label={String(month.getFullYear())}
					testId={`${testId}-year`}
					width={72}
					// Inside the calendar's own box, which is what is kept on screen.
					maxHeight={136}
					color={GUI_THEME.primary}
				>
					{closeMenu =>
						years.map(year => (
							<MenuItem
								key={year}
								role="option"
								selected={year === month.getFullYear()}
								testId={`${testId}-year-option`}
								onSelect={() => {
									closeMenu();
									go(new Date(year, month.getMonth(), 1));
								}}
							>
								{year}
							</MenuItem>
						))
					}
				</Menu>
				<span style={{flex: 1}} />
				<IconButton
					title="Previous month"
					testId={`${testId}-previous`}
					disabled={atStart}
					onClick={() =>
						go(new Date(month.getFullYear(), month.getMonth() - 1, 1))
					}
				>
					<IconChevronLeft size={ICON_SIZE} />
				</IconButton>
				<IconButton
					title="Next month"
					testId={`${testId}-next`}
					disabled={atEnd}
					onClick={() =>
						go(new Date(month.getFullYear(), month.getMonth() + 1, 1))
					}
				>
					<IconChevronRight size={ICON_SIZE} />
				</IconButton>
			</div>
			<DayGrid
				month={month}
				onMonth={go}
				selected={selected}
				today={today}
				onPick={date => {
					onPick(dayOf(date));
					close();
					triggerRef.current?.focus();
				}}
			/>
		</div>
	);

	return (
		<div
			ref={ref}
			style={{display: 'inline-flex'}}
			// Tabbed away from, as from a click elsewhere: closed. React carries
			// the portalled popover's blur up here too. A blur to nothing — a
			// click on the popover's own padding — is not leaving.
			onBlur={event => {
				const next = event.relatedTarget;
				if (!open || !(next instanceof Node)) return;
				if (ref.current?.contains(next) || listRef.current?.contains(next))
					return;

				close();
			}}
		>
			<button
				ref={triggerRef}
				type="button"
				data-testid={testId}
				aria-label={label}
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				style={{
					...selectTriggerStyle(
						value ? GUI_THEME.primary : GUI_THEME.dim2,
						false,
					),
					gap: 8,
					// The size of the lists beside it.
					fontSize: 12,
					padding: '5px 8px 5px 10px',
				}}
			>
				<span style={selectLabelStyle}>{value || placeholder}</span>
				<span
					data-testid={`${testId}-icon`}
					style={{display: 'inline-flex', color: GUI_THEME.dim2}}
				>
					<IconCalendar size={12} />
				</span>
			</button>

			{open && createPortal(popover, portalInto?.() ?? document.body)}
		</div>
	);
};
