// The ticket panel's Goal row. A ticket in a goal names it and can leave
// it; a goal lists its tickets; any other ticket can be
// put in one, picked from the goals there are or from any ticket by title.

import React, {useState} from 'react';
import {useAddRow} from '../lib/use-add-row';
import {GUI_THEME} from '../lib/gui-theme';
import {GuiIssue} from '../lib/gui-state.model';
import {GoalIndex, GoalSummary} from '../lib/goal-index';
import {Button} from './Button';
import {AddRow, ChipRow, Empty, Input} from './FormPrimitives';
import {GoalLabel} from './GoalLabel';
import {ManageGoalsModal} from './ManageGoalsModal';
import {MenuItem} from './Menu';
import {Section} from './Section';
import {popoverStyle} from '../lib/select-style';

const PICK_LIMIT = 8;

const label = (issue: GuiIssue) => `${issue.ref} ${issue.title}`;

export const GoalSection = ({
	issue,
	asGoal,
	goals,
	candidates,
	onSetGoal,
	onCreateGoal,
	onRemoveGoal,
	onOpenIssue,
}: {
	issue: GuiIssue;
	asGoal: GoalSummary | null;
	goals: GoalIndex;
	// Every ticket there is, for the picker.
	candidates: GuiIssue[];
	onSetGoal: (issueId: string, goal: string | null) => void;
	onCreateGoal: (issueId: string, title: string) => void;
	onRemoveGoal: (goalId: string) => void;
	onOpenIssue: (issueId: string) => void;
}) => {
	const row = useAddRow();
	const [query, setQuery] = useState('');
	const [lit, setLit] = useState(0);
	const [managing, setManaging] = useState(false);
	const disabled = issue.readonly;

	// A goal is in none itself; any other ticket opens to the picker.
	const canOpen = !disabled && !asGoal;
	const start = canOpen && !row.open ? row.start : undefined;
	const picking = row.open && !asGoal;

	const needle = query.trim().toLowerCase();
	const matches = (candidate: GuiIssue) =>
		!needle || label(candidate).toLowerCase().includes(needle);

	const existing = candidates.filter(
		candidate =>
			goals.has(candidate.id) &&
			candidate.id !== issue.id &&
			candidate.id !== issue.goal?.id &&
			matches(candidate),
	);
	const others = needle
		? candidates.filter(
				candidate =>
					!goals.has(candidate.id) &&
					!candidate.goal &&
					!candidate.isClosed &&
					candidate.id !== issue.id &&
					matches(candidate),
		  )
		: [];
	const options = [...existing, ...others].slice(0, PICK_LIMIT);

	const pick = (goalId: string) => {
		onSetGoal(issue.id, goalId);
		row.close();
		setQuery('');
	};

	const leave = () => {
		onSetGoal(issue.id, null);
		row.close();
		setQuery('');
	};

	const typed = query.trim();
	const create = () => {
		onCreateGoal(issue.id, typed);
		row.close();
		setQuery('');
	};
	// Offered unless a goal by that name is already listed to pick.
	const canCreate =
		typed !== '' &&
		!options.some(
			option =>
				goals.has(option.id) &&
				option.title.toLowerCase() === typed.toLowerCase(),
		);

	// The rows the dropdown lists, the lit one picked by Enter.
	const choices = [
		// Not while searching, or Enter would take the ticket out of its goal.
		...(issue.goal && !needle
			? [
					{
						key: 'none',
						testId: 'goal-leave',
						choose: leave,
						content: <span style={{color: GUI_THEME.dim}}>No goal</span>,
					},
			  ]
			: []),
		...options.map(option => ({
			key: option.id,
			testId: 'goal-option',
			choose: () => pick(option.id),
			content: (
				<span
					style={{
						display: 'flex',
						alignItems: 'baseline',
						gap: 8,
						minWidth: 0,
						flex: 1,
					}}
				>
					<span
						aria-hidden
						style={{
							width: 2,
							alignSelf: 'stretch',
							flexShrink: 0,
							background: goals.get(option.id)?.color ?? 'transparent',
						}}
					/>
					<span style={{color: GUI_THEME.dim, fontSize: 10, flexShrink: 0}}>
						{option.ref}
					</span>
					<span
						style={{
							overflow: 'hidden',
							textOverflow: 'ellipsis',
							whiteSpace: 'nowrap',
						}}
					>
						{option.title}
					</span>
				</span>
			),
		})),
		...(canCreate
			? [
					{
						key: 'create',
						testId: 'goal-create',
						choose: create,
						content: <span>New goal “{typed}”</span>,
					},
			  ]
			: []),
		...(!needle
			? [
					{
						key: 'manage',
						testId: 'goal-manage',
						choose: () => {
							row.close();
							setManaging(true);
						},
						content: <span style={{color: GUI_THEME.dim}}>Manage goals…</span>,
					},
			  ]
			: []),
	];
	// Clamped: the list shrinks as the query narrows it.
	const litAt = Math.min(lit, choices.length - 1);

	return (
		<Section
			title="Goal"
			focusProps={canOpen ? row.sectionProps : undefined}
			action={
				(start && (
					<Button variant="ghost" onClick={start}>
						+
					</Button>
				)) ||
				(row.open && (
					<Button variant="ghost" onClick={row.close}>
						-
					</Button>
				))
			}
		>
			{asGoal ? (
				<>
					<ChipRow testId="goal-own-row">
						<GoalLabel
							testId="goal-own"
							place={{kind: 'panel'}}
							strong
							color={asGoal.color}
							label={`Goal · ${asGoal.done}/${asGoal.members.length} done`}
						/>
					</ChipRow>
					<div
						data-testid="goal-members"
						style={{display: 'flex', flexDirection: 'column', gap: 2}}
					>
						{asGoal.members.map(member => (
							<button
								key={member.id}
								type="button"
								data-testid="goal-member"
								onClick={() => onOpenIssue(member.id)}
								style={{
									display: 'flex',
									gap: 8,
									alignItems: 'baseline',
									padding: '3px 0',
									borderWidth: 0,
									background: 'transparent',
									textAlign: 'left',
									cursor: 'pointer',
									fontFamily: 'inherit',
									fontSize: 12,
									color: member.isClosed
										? GUI_THEME.dim
										: GUI_THEME.primarySoft,
								}}
							>
								<span
									style={{color: GUI_THEME.dim, fontSize: 10, flexShrink: 0}}
								>
									{member.ref}
								</span>
								<span
									style={{
										overflow: 'hidden',
										textOverflow: 'ellipsis',
										whiteSpace: 'nowrap',
									}}
								>
									{member.title}
								</span>
							</button>
						))}
					</div>
				</>
			) : issue.goal ? (
				<ChipRow testId="goal-row" onActivate={start}>
					<GoalLabel
						testId="goal-current"
						place={{kind: 'panel'}}
						color={issue.goal.color}
						label={issue.goal.title}
						disabled={disabled || row.open}
						onPress={row.start}
						pressTitle="Change goal"
					/>
				</ChipRow>
			) : (
				<ChipRow testId="goal-row">
					<Empty testId="goal-empty" onActivate={start}>
						No goal
					</Empty>
				</ChipRow>
			)}

			{picking && (
				<div style={{position: 'relative'}}>
					<AddRow>
						<Input
							ref={row.inputRef}
							data-testid="goal-search"
							value={query}
							placeholder="Find a goal, or name a new one"
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
								if (event.key === 'Escape') row.close();
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
									{needle ? 'No ticket matches' : 'Type to find a ticket'}
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
			{managing && (
				<ManageGoalsModal
					goals={goals}
					issues={candidates}
					onOpen={goalId => {
						setManaging(false);
						onOpenIssue(goalId);
					}}
					onRemove={onRemoveGoal}
					onClose={() => setManaging(false)}
				/>
			)}
		</Section>
	);
};
