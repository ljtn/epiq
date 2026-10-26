// The ticket panel's Goal row: a dropdown naming the ticket's goal, or No
// goal, that picks another of the project's goals, names a new one, or opens
// Manage goals.

import {useState} from 'react';
import {useAddRow} from '../lib/use-add-row';
import {GUI_THEME} from '../lib/gui-theme';
import {GuiGoal, GuiIssue} from '../lib/gui-state.model';
import {AddRow, Input} from './FormPrimitives';
import {MenuItem} from './Menu';
import {Section} from './Section';
import {popoverStyle, selectLabelStyle} from '../lib/select-style';
import {IconChevronDown} from './IconChevronDown';

const PICK_LIMIT = 8;

const ColourBar = ({color, height}: {color: string; height: number}) => (
	<span
		aria-hidden
		style={{width: 3, height, flexShrink: 0, background: color}}
	/>
);

export const GoalSection = ({
	issue,
	goals,
	onSetGoal,
	onCreateGoal,
	onManageGoals,
}: {
	issue: GuiIssue;
	// The project's goals.
	goals: GuiGoal[];
	onSetGoal: (issueId: string, goal: string | null) => void;
	// Absent where the ticket takes no new goal.
	onCreateGoal?: (name: string) => void;
	onManageGoals?: () => void;
}) => {
	const row = useAddRow();
	const [query, setQuery] = useState('');
	const [lit, setLit] = useState(0);
	const disabled = issue.readonly;

	const typed = query.trim();
	const needle = typed.toLowerCase();
	const options = goals
		.filter(
			goal =>
				goal.id !== issue.goal?.id &&
				(!needle || goal.name.toLowerCase().includes(needle)),
		)
		.slice(0, PICK_LIMIT);

	const done = () => {
		row.close();
		setQuery('');
	};

	const create =
		onCreateGoal &&
		typed !== '' &&
		!goals.some(goal => goal.name.toLowerCase() === needle)
			? () => {
					onCreateGoal(typed);
					done();
			  }
			: null;

	// The rows the dropdown lists, the lit one picked by Enter.
	const choices = [
		// Not while searching, or Enter would take the ticket out of its goal.
		...(issue.goal && !needle
			? [
					{
						key: 'none',
						testId: 'goal-leave',
						choose: () => {
							onSetGoal(issue.id, null);
							done();
						},
						content: <span style={{color: GUI_THEME.dim}}>No goal</span>,
					},
			  ]
			: []),
		...options.map(goal => ({
			key: goal.id,
			testId: 'goal-option',
			choose: () => {
				onSetGoal(issue.id, goal.id);
				done();
			},
			content: (
				<span
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 8,
						minWidth: 0,
						flex: 1,
					}}
				>
					<ColourBar color={goal.color} height={12} />
					<span
						style={{
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{goal.name}
					</span>
				</span>
			),
		})),
		...(create
			? [
					{
						key: 'create',
						testId: 'goal-create',
						choose: create,
						content: <span>New goal “{typed}”</span>,
					},
			  ]
			: []),
		...(onManageGoals && !needle
			? [
					{
						key: 'manage',
						testId: 'goal-manage',
						choose: () => {
							done();
							onManageGoals();
						},
						content: <span style={{color: GUI_THEME.dim}}>Manage goals…</span>,
					},
			  ]
			: []),
	];
	// Clamped: the list shrinks as the query narrows it.
	const litAt = Math.min(lit, choices.length - 1);

	return (
		<Section title="Goal">
			{!row.open && (
				<button
					type="button"
					data-testid="goal-current"
					disabled={disabled}
					onClick={row.start}
					style={{
						// The search box's face, so opening it changes nothing but the text.
						font: 'inherit',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'space-between',
						gap: 6,
						width: '100%',
						boxSizing: 'border-box',
						marginTop: 10,
						background: GUI_THEME.well,
						color: issue.goal?.color ?? GUI_THEME.dim,
						border: `1px solid ${GUI_THEME.line}`,
						borderRadius: 8,
						padding: '8px 10px',
						textAlign: 'left',
						cursor: disabled ? 'not-allowed' : 'pointer',
						opacity: disabled ? 0.4 : 1,
					}}
				>
					<span
						style={{
							...selectLabelStyle,
							display: 'flex',
							alignItems: 'center',
							gap: 8,
						}}
					>
						{issue.goal && <ColourBar color={issue.goal.color} height={14} />}
						{issue.goal?.name ?? 'No goal'}
					</span>
					<IconChevronDown size={12} />
				</button>
			)}

			{row.open && (
				// A dropdown: a press anywhere outside it, even in the section, closes it.
				<div {...row.sectionProps} style={{position: 'relative'}}>
					<AddRow>
						<Input
							ref={row.inputRef}
							data-testid="goal-search"
							value={query}
							placeholder={
								onCreateGoal ? 'Find a goal, or name a new one' : 'Find a goal'
							}
							onChange={event => {
								setQuery(event.target.value);
								setLit(0);
							}}
							onKeyDown={event => {
								if (
									(event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
									choices.length > 0
								) {
									event.preventDefault();
									const step = event.key === 'ArrowDown' ? 1 : -1;
									setLit(at => (at + step + choices.length) % choices.length);
								}
								if (event.key === 'Enter') choices[litAt]?.choose();
								if (event.key === 'Escape') done();
							}}
						/>
					</AddRow>
					<div
						data-testid="goal-options"
						role="listbox"
						style={{...popoverStyle, right: 0, whiteSpace: undefined}}
					>
						{choices.length === 0 ? (
							<MenuItem>
								<span style={{color: GUI_THEME.dim}}>
									{needle ? 'No goal matches' : 'No goals yet'}
								</span>
							</MenuItem>
						) : (
							choices.map((choice, at) => (
								<MenuItem
									key={choice.key}
									role="option"
									testId={choice.testId}
									selected={at === litAt}
									onSelect={choice.choose}
								>
									{choice.content}
								</MenuItem>
							))
						)}
					</div>
				</div>
			)}
		</Section>
	);
};
