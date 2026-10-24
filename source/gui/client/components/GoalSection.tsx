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
import {Section} from './Section';

const PICK_LIMIT = 8;

const label = (issue: GuiIssue) => `${issue.ref} ${issue.title}`;

export const GoalSection = ({
	issue,
	asGoal,
	goals,
	candidates,
	onSetGoal,
	onOpenIssue,
}: {
	issue: GuiIssue;
	asGoal: GoalSummary | null;
	goals: GoalIndex;
	// Every ticket there is, for the picker.
	candidates: GuiIssue[];
	onSetGoal: (issueId: string, goal: string | null) => void;
	onOpenIssue: (issueId: string) => void;
}) => {
	const row = useAddRow();
	const [query, setQuery] = useState('');
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
				<>
					<AddRow>
						<Input
							ref={row.inputRef}
							data-testid="goal-search"
							value={query}
							placeholder="Goal, or any ticket by title"
							onChange={event => setQuery(event.target.value)}
							onKeyDown={event => {
								if (event.key === 'Enter' && options[0]) pick(options[0].id);
								if (event.key === 'Escape') row.close();
							}}
						/>
					</AddRow>
					<ChipRow testId="goal-options">
						{issue.goal && (
							<Button
								variant="ghost"
								testId="goal-leave"
								onClick={() => {
									onSetGoal(issue.id, null);
									row.close();
								}}
							>
								No goal
							</Button>
						)}
						{options.length === 0 ? (
							<Empty>
								{needle ? 'No ticket matches' : 'Type to find a ticket'}
							</Empty>
						) : (
							options.map(option => {
								const color = goals.get(option.id)?.color ?? GUI_THEME.dim;

								return (
									<GoalLabel
										key={option.id}
										testId="goal-option"
										place={{kind: 'panel'}}
										color={color}
										label={`+ ${label(option)}`}
										onPress={() => pick(option.id)}
									/>
								);
							})
						)}
					</ChipRow>
				</>
			)}
		</Section>
	);
};
