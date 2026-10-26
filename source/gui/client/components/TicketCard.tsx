import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {GuiComment, GuiIssue, GuiTag} from '../lib/gui-state.model';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {
	THEATRE_CARD_IN_ANIMATION,
	THEATRE_FLASH_FRAMES,
	THEATRE_FLASH_TIMING,
} from '../lib/theatre';
import {isSwimlaneDrag} from '../lib/gui-move-swimlane';
// Types only, over the boundary `use-swimlane-stats` reads its own over.
import {RefDiffStat} from '../../../lib/stats/ref-diff-stats.model.js';
import {CARD_DIFF_GAP} from '../lib/diff-stat.style';
import {
	CardDensityView,
	assigneeText,
	DENSE_ASSIGNEE_WIDTH,
	DENSE_GAP,
	DENSE_MAX_TAGS,
	DENSE_LINE_GAP,
	DENSE_TAG_HIT,
	DENSE_MARKER_SIZE,
	useCardDensityView,
} from '../lib/card-density';
import {Button} from './Button';
import {GoalLabel, GoalStripe} from './GoalMarks';
import {DiffStat} from './DiffStat';
import {CardActivity, DwellLevel} from '../lib/lane-dwell';
import {formatDuration} from '../lib/gui-format.helper';
import {CopyRef} from './CopyRef';
import {IconButton, ICON_SIZE} from './IconButton';
import {IconClock} from './IconClock';
import {IconComment} from './IconComment';

/** How long this ticket has sat in its lane, and how that reads beside its peers. */
export type CardDwell = {ms: number; level: DwellLevel};

// The one thing the figures beside it do not already say.
const diffTitle = (diff: RefDiffStat): string =>
	`${diff.commits} commit${diff.commits === 1 ? '' : 's'}`;

const DWELL_COLOR: Record<DwellLevel, string> = {
	none: GUI_THEME.dim,
	warn: GUI_THEME.amber,
	alert: GUI_THEME.red,
};

// The commits behind a ticket, as a figure that opens them. Nothing at all
// where they changed no lines — an empty commit, a pure rename: the stat would
// draw nothing there, and the button around it would be an invisible thing to
// hover and click.
const DiffButton = ({
	diff,
	onOpen,
	variant = 'card',
}: {
	diff: RefDiffStat | null;
	onOpen: () => void;
	variant?: 'card' | 'row';
}) => {
	const [hovered, setHovered] = useState(false);
	if (!diff || diff.insertions + diff.deletions === 0) return null;

	return (
		<button
			type="button"
			data-testid="ticket-diff"
			title={diffTitle(diff)}
			// Stopped here, or the click would also select the card — which would
			// land on whichever tab was already open.
			onClick={event => {
				event.stopPropagation();
				onOpen();
			}}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			// The hover ground is the button's only chrome, and it is pulled back
			// out again by an equal negative margin: the ground reaches past the
			// figures without the line growing under it.
			//
			// Deliberately not an `IconButton`, which every other control of this
			// kind is: that one is a 24px square that lights to the accent, and
			// both would be wrong here — what lights is the stat, in its own two
			// colours.
			style={{
				display: 'flex',
				alignItems: 'center',
				padding: '2px 4px',
				margin: '-2px -4px',
				borderRadius: 4,
				background: hovered ? GUI_THEME.hover : 'transparent',
				border: 'none',
				cursor: 'pointer',
				transition: 'background 120ms ease',
			}}
		>
			<DiffStat
				insertions={diff.insertions}
				deletions={diff.deletions}
				variant={variant}
				lit={hovered}
			/>
		</button>
	);
};

// Something happened to the ticket in the last few minutes: a small breathing
// dot. Run off the element as the card's own flash is, so the board
// re-rendering does not restart it.
const LiveDot = () => {
	const ref = useRef<HTMLSpanElement | null>(null);
	const color = GUI_THEME.accent;

	useEffect(() => {
		const dot = ref.current;
		if (!dot) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		const animation = dot.animate(
			[
				{opacity: 1, boxShadow: `0 0 0 0 ${color}`},
				{opacity: 0.55, boxShadow: `0 0 0 3px ${color}00`},
				{opacity: 1, boxShadow: `0 0 0 0 ${color}`},
			],
			{duration: 1800, iterations: Infinity, easing: 'ease-in-out'},
		);

		return () => animation.cancel();
	}, [color]);

	return (
		<span
			ref={ref}
			style={{
				width: DENSE_MARKER_SIZE,
				height: DENSE_MARKER_SIZE,
				borderRadius: 999,
				background: color,
				flexShrink: 0,
			}}
		/>
	);
};

// A title cut at one line. Where it is cut, the whole of it is its tooltip;
// one that fits needs none. Measured as the lane resizes, not on hover, so the
// tooltip layer finds the title already there when the pointer arrives.
const OneLineTitle = ({
	title,
	view,
}: {
	title: string;
	view: CardDensityView;
}) => {
	const ref = useRef<HTMLDivElement | null>(null);
	const [cut, setCut] = useState(false);

	useLayoutEffect(() => {
		const box = ref.current;
		if (!box) return;

		const measure = () => setCut(box.scrollWidth > box.clientWidth);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(box);

		return () => observer.disconnect();
	}, [title]);

	return (
		<div
			ref={ref}
			data-testid="ticket-title"
			title={cut ? title : undefined}
			style={{
				fontSize: view.metrics.titleFontSize,
				lineHeight: `${view.metrics.titleLineHeight}px`,
				whiteSpace: 'nowrap',
				overflow: 'hidden',
				textOverflow: 'ellipsis',
			}}
		>
			{title}
		</div>
	);
};

// Something on a dense card that narrows the board to itself: the button
// around it, whose target reaches past it by `reach` on each side and shows
// its edge under the pointer, as a button's does. Pulled back by the same
// reach, so it takes no more room than what it holds. Shared by the tag marks
// and the assignee's name.
const FilterTarget = ({
	testId,
	pressed,
	title,
	onFilter,
	reach,
	children,
}: {
	testId: string;
	pressed: boolean;
	title?: string;
	onFilter: () => void;
	reach: {x: number; y: number};
	children: (hovered: boolean) => React.ReactNode;
}) => {
	const [hovered, setHovered] = useState(false);

	return (
		<button
			type="button"
			data-testid={testId}
			aria-pressed={pressed}
			title={title}
			// Stopped here, or the click would also select the card.
			onClick={event => {
				event.stopPropagation();
				onFilter();
			}}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				justifyContent: 'center',
				minWidth: 0,
				font: 'inherit',
				color: 'inherit',
				// The border counted in the padding, so the target never moves.
				padding: `${reach.y - 1}px ${reach.x - 1}px`,
				margin: `${-reach.y}px ${-reach.x}px`,
				border: `1px solid ${hovered ? GUI_THEME.secondary : 'transparent'}`,
				borderRadius: 4,
				background: 'transparent',
				cursor: 'pointer',
				transition: 'border-color 120ms ease',
			}}
		>
			{children(hovered)}
		</button>
	);
};

// One tag as a small outlined square, and the way to narrow the board to it,
// as a full card's chip is. Outlined, so a row of them never reads as status
// lights beside the diff's green and red; filled for the tag the board is
// narrowed to.
const TagMark = ({
	tag,
	isolated,
	onFilter,
}: {
	tag: GuiTag;
	isolated: boolean;
	onFilter: () => void;
}) => (
	<FilterTarget
		testId="ticket-tag"
		pressed={isolated}
		title={isolated ? `${tag.name}: show every ticket again` : tag.name}
		onFilter={onFilter}
		reach={{x: DENSE_TAG_HIT, y: DENSE_TAG_HIT}}
	>
		{hovered => (
			<span
				style={{
					width: DENSE_MARKER_SIZE,
					height: DENSE_MARKER_SIZE,
					borderRadius: 1.5,
					boxSizing: 'border-box',
					border: `1.5px solid ${tag.color}`,
					background: isolated ? tag.color : 'transparent',
					opacity: hovered || isolated ? 1 : 0.85,
				}}
			/>
		)}
	</FilterTarget>
);

// Who has a ticket, quietly, as their name: the way to narrow the board to
// their tickets, as a tag is to its own. Shared by both densities, a dense
// card holding it in a slot of fixed width.
const AssigneeName = ({
	assignees,
	isolatedAssigneeId,
	onFilterByAssignee,
}: {
	assignees: GuiIssue['assignees'];
	isolatedAssigneeId: string | null;
	onFilterByAssignee: (assigneeId: string) => void;
}) => {
	const assignee = assignees[0];
	if (!assignee) return null;

	const label = assigneeText(assignees);
	const isolated = assignee.id === isolatedAssigneeId;

	return (
		<FilterTarget
			testId="ticket-assignee"
			pressed={isolated}
			title={
				isolated
					? `${assignee.name}: show every ticket again`
					: label.cut
					? label.full
					: undefined
			}
			onFilter={() => onFilterByAssignee(assignee.id)}
			reach={{x: 4, y: 2}}
		>
			{hovered => (
				<span
					style={{
						overflow: 'hidden',
						whiteSpace: 'nowrap',
						color: hovered || isolated ? GUI_THEME.primary : GUI_THEME.dim,
						transition: 'color 120ms ease',
					}}
				>
					{label.text}
				</span>
			)}
		</FilterTarget>
	);
};

// A ticket in two parts: its title across the whole width, and under it one
// line of what identifies and measures it — the ref and what its commits came
// to on the left, its tags and whether it is live or stalled on the right.
// Dwell, comments and assignees are left to the details panel.
const DenseBody = ({
	ticket,
	diff,
	view,
	activity,
	isolatedTagId,
	onFilterByTag,
	isolatedAssigneeId,
	onFilterByAssignee,
	onOpenCode,
	goal,
}: {
	ticket: GuiIssue;
	// Its goal's label, leading the line under the title.
	goal: React.ReactNode;
	diff: RefDiffStat | null;
	view: CardDensityView;
	activity: CardActivity;
	isolatedTagId: string | null;
	onFilterByTag: (tagId: string) => void;
	isolatedAssigneeId: string | null;
	onFilterByAssignee: (assigneeId: string) => void;
	onOpenCode: () => void;
}) => {
	return (
		<>
			{view.titleLines === 1 ? (
				<OneLineTitle title={ticket.title} view={view} />
			) : (
				<div
					data-testid="ticket-title"
					style={{
						fontSize: view.metrics.titleFontSize,
						lineHeight: `${view.metrics.titleLineHeight}px`,
						overflow: 'hidden',
						display: '-webkit-box',
						WebkitBoxOrient: 'vertical',
						WebkitLineClamp: 2,
						wordBreak: 'break-word',
					}}
				>
					{ticket.title}
				</div>
			)}

			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					gap: DENSE_GAP,
					fontSize: TEXT.label,
					lineHeight: '12px',
					// As tall as the goal's label, so a card with one is no taller.
					minHeight: view.metrics.metaLineHeight,
					minWidth: 0,
				}}
			>
				{goal}

				{ticket.ref && (
					<span
						data-testid="ticket-ref"
						// An id to quote, not a heading to read.
						style={{flexShrink: 0, opacity: 0.7}}
					>
						<CopyRef refValue={ticket.ref} />
					</span>
				)}

				{/* Who has it, quietly, in a slot of one width whether anyone does
				    or not, so the diff after it lines up down the lane. The name
				    narrows the board to that person's tickets, as a tag does. */}
				<span
					style={{
						width: DENSE_ASSIGNEE_WIDTH,
						// The one part of the line that gives where it is tight: a card
						// with many tags keeps them and its live mark whole.
						flexShrink: 1,
						display: 'flex',
						minWidth: 0,
					}}
				>
					<AssigneeName
						assignees={ticket.assignees}
						isolatedAssigneeId={isolatedAssigneeId}
						onFilterByAssignee={onFilterByAssignee}
					/>
				</span>

				{/* What its commits came to: a bar one size on every row between
				    what was added and what was removed. */}
				<DiffButton diff={diff} onOpen={onOpenCode} variant="row" />

				<span style={{flex: 1}} />

				<span
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: 5,
						flexShrink: 0,
					}}
				>
					{/* Squared, so a tag never reads as the round live dot. */}
					{ticket.tags.slice(0, DENSE_MAX_TAGS).map(tag => (
						<TagMark
							key={tag.id}
							tag={tag}
							isolated={tag.id === isolatedTagId}
							onFilter={() => onFilterByTag(tag.id)}
						/>
					))}
					{/* The rest named on hover rather than run off the card. */}
					{ticket.tags.length > DENSE_MAX_TAGS && (
						<span
							data-testid="ticket-tags-more"
							title={ticket.tags
								.slice(DENSE_MAX_TAGS)
								.map(tag => tag.name)
								.join(', ')}
							style={{color: GUI_THEME.dim, lineHeight: 1}}
						>
							…
						</span>
					)}

					{activity === 'stalled' && (
						<span
							data-testid="ticket-stalled"
							title="Nothing has happened here for longer than this lane usually holds a ticket"
							style={{display: 'inline-flex', color: GUI_THEME.amber}}
						>
							<IconClock size={10} />
						</span>
					)}

					{activity === 'live' && (
						<span
							data-testid="ticket-live"
							title="Board activity in the last five minutes"
							style={{display: 'inline-flex'}}
						>
							<LiveDot />
						</span>
					)}
				</span>
			</div>
		</>
	);
};

export const TicketCard = ({
	ticket,
	index,
	isSelected,
	isPicked,
	commentCount,
	onOpenComments,
	onOpenCode,
	onSelect,
	isolatedTagId,
	onFilterByTag,
	isolatedAssigneeId = null,
	onFilterByAssignee = () => {},
	onDragOverIssue,
	onDropIssueAt,
	theatre,
	flashKey,
	dwell,
	diff,
	activity = null,
	isolatedGoalId = null,
	onFilterByGoal,
}: {
	ticket: GuiIssue;
	// The goal the board is narrowed to, and narrowing to one from its pill.
	isolatedGoalId?: string | null;
	onFilterByGoal?: (goalId: string) => void;
	index: number;
	isSelected: boolean;
	// Part of a multi-ticket selection, which reads differently from the one
	// ticket whose details are open.
	isPicked: boolean;
	onSelect: (options: {toggle: boolean}) => void;
	commentCount: number;
	onOpenComments: (issueId: string) => void;
	// The diff stat is the way into the commits behind it, the way the comment
	// count is the way into the comments.
	onOpenCode: (issueId: string) => void;
	// The tag the board is narrowed to, if it is exactly one.
	isolatedTagId: string | null;
	onFilterByTag: (tagId: string) => void;
	// The assignee every card is narrowed to, if exactly one, and narrowing to
	// one from a card's name.
	isolatedAssigneeId?: string | null;
	onFilterByAssignee?: (assigneeId: string) => void;
	onDragOverIssue: (targetIndex: number) => void;
	onDropIssueAt: (issueId: string, targetIndex: number) => void;
	// The history player is up, so a card arriving on the board is one the movie
	// just produced and is worth an entrance.
	theatre: boolean;
	// The id of the event that just landed on this ticket, or null. Its identity
	// is what matters, not its content: two events in a row on one ticket have
	// to flash twice.
	flashKey: string | null;
	// Null while the board is not showing the present, where an elapsed time
	// measured against now means nothing.
	dwell: CardDwell | null;
	// What the commits naming this ticket add up to, or null for a ticket no
	// commit names — which draws nothing at all. Most of a board is tickets
	// nobody has written code for yet, and a flat grey line on every one of
	// them would be a column of noise saying nothing.
	diff: RefDiffStat | null;
	// Dense cards only: live or stalled, as the lane reads it.
	activity?: CardActivity;
}) => {
	const cardRef = useRef<HTMLDivElement | null>(null);
	const view = useCardDensityView();
	const dense = view.density === 'dense';
	const TITLE_LINE_HEIGHT = view.metrics.titleLineHeight;

	// Opening the details panel takes 440px off the board, which can leave the
	// card that was just clicked behind it.
	useEffect(() => {
		if (!isSelected) return;

		cardRef.current?.scrollIntoView({
			behavior: 'smooth',
			block: 'nearest',
			inline: 'nearest',
		});
	}, [isSelected]);

	// Run off the element rather than through a CSS animation on the style prop:
	// the card's entrance already owns that property, and the board re-renders
	// on every frame of the movie, which would put the entrance back and cut a
	// running flash short. A web animation overrides the inline styles for its
	// own duration and reverts, and starts fresh on every call — which is what
	// makes two events in a row on one ticket flash twice.
	//
	// Deliberately not cancelled on the way out: events land closer together
	// than the flash is long, so cancelling as the spotlight moves to the next
	// ticket would cut every one of them short. A later flash on this same card
	// simply wins, and a finished one drops off on its own.
	useEffect(() => {
		const card = cardRef.current;
		if (!card || flashKey === null) return;
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		card.animate(THEATRE_FLASH_FRAMES, THEATRE_FLASH_TIMING);
	}, [flashKey]);

	const getVisualTargetIndex = (isAfterMiddle: boolean) =>
		index + (isAfterMiddle ? 1 : 0);

	// Its goal's label, which narrows the board to that goal.
	const goal = ticket.goal;
	const goalIsolated = goal !== undefined && goal.id === isolatedGoalId;
	const goalLabel = goal ? (
		<GoalLabel
			testId="ticket-goal"
			color={goal.color}
			label={goal.name}
			height={view.metrics.metaLineHeight}
			{...(onFilterByGoal && {
				pressed: goalIsolated,
				onPress: () => onFilterByGoal(goal.id),
				pressTitle: goalIsolated
					? 'Show every ticket again'
					: 'Show only this goal',
			})}
		/>
	) : null;

	return (
		<div
			ref={cardRef}
			draggable={!ticket.readonly}
			// Stopped here, or the board's own click handler would clear the
			// selection this click just made.
			onClick={event => {
				event.stopPropagation();
				onSelect({toggle: event.metaKey || event.ctrlKey || event.shiftKey});
			}}
			// Carries the id and nothing else. Selecting here would navigate to
			// the issue route mid-drag, remounting the board under the pointer so
			// the drop never lands.
			onDragStart={event => {
				event.dataTransfer.effectAllowed = 'move';
				event.dataTransfer.setData('text/plain', ticket.id);
			}}
			onDragOver={event => {
				// A swimlane crossing the card belongs to the column underneath, which
				// decides its own landing edge.
				if (isSwimlaneDrag(event.dataTransfer)) return;

				event.preventDefault();
				event.dataTransfer.dropEffect = 'move';

				const rect = event.currentTarget.getBoundingClientRect();
				const isAfterMiddle = event.clientY > rect.top + rect.height / 2;

				onDragOverIssue(getVisualTargetIndex(isAfterMiddle));
			}}
			onDrop={event => {
				// Before stopPropagation, or a column dropped over a card would be
				// swallowed here and never reach the section's own handler.
				if (isSwimlaneDrag(event.dataTransfer)) return;

				event.preventDefault();
				event.stopPropagation();

				const issueId = event.dataTransfer.getData('text/plain');
				if (!issueId) return;

				const rect = event.currentTarget.getBoundingClientRect();
				const isAfterMiddle = event.clientY > rect.top + rect.height / 2;

				onDropIssueAt(issueId, getVisualTargetIndex(isAfterMiddle));
			}}
			style={{
				display: 'flex',
				flexDirection: dense ? 'column' : undefined,
				alignItems: dense ? 'stretch' : 'flex-start',
				gap: dense ? DENSE_LINE_GAP : 0,
				// Inherited by the title and nothing else: everything else on the card
				// sets a tone of its own.
				color:
					isSelected || isPicked ? GUI_THEME.primary : GUI_THEME.primarySoft,
				fontSize: 11,
				cursor: ticket.readonly ? 'default' : 'grab',
				// A selected card is a step above a resting one, not a different
				// colour at the same weight: the two washes have to move together,
				// or picking one stops reading as picking it up.
				background:
					isSelected || isPicked
						? 'rgba(185, 192, 255, 0.1)'
						: 'rgba(185, 192, 255, 0.065)',
				// Roomier than a list row: a card is read, not scanned, and the
				// air around its title is what keeps a column of them from
				// running together.
				padding: view.metrics.padding,
				minHeight: view.metrics.minHeight,
				boxSizing: 'border-box',
				borderRadius: view.metrics.radius,
				marginBottom: view.metrics.gap,
				border: `1px solid ${
					isSelected || isPicked ? GUI_THEME.accentEdge : 'transparent'
				}`,
				position: 'relative',
				// The flash is applied to the node directly (see above), so it must
				// not be set here too or React would put it back on every render and
				// cut the running one short.
				animation: theatre ? THEATRE_CARD_IN_ANIMATION : undefined,
			}}
		>
			{goal && <GoalStripe color={goal.color} inset={view.metrics.radius} />}
			{dense ? (
				<DenseBody
					goal={goalLabel}
					ticket={ticket}
					diff={diff}
					view={view}
					activity={activity}
					isolatedTagId={isolatedTagId}
					onFilterByTag={onFilterByTag}
					isolatedAssigneeId={isolatedAssigneeId}
					onFilterByAssignee={onFilterByAssignee}
					onOpenCode={() => onOpenCode(ticket.id)}
				/>
			) : (
				<>
					<div
						style={{
							flex: 1,
							minWidth: 0,
							display: 'flex',
							flexDirection: 'column',
							gap: 12,
						}}
					>
						{/* The title and, at its right, the controls centred on its first
						    line; the line under it runs the card's whole width. */}
						<div
							style={{
								display: 'flex',
								justifyContent: 'space-between',
								gap: 8,
								minWidth: 0,
							}}
						>
							<div
								data-testid="ticket-title"
								style={{
									flex: 1,
									minWidth: 0,
									display: '-webkit-box',
									WebkitLineClamp: 2,
									WebkitBoxOrient: 'vertical',
									overflow: 'hidden',
									fontWeight: 400,
									fontSize: 12,
									lineHeight: `${TITLE_LINE_HEIGHT}px`,
									wordBreak: 'break-word',
								}}
							>
								{ticket.title}
							</div>

							{/* The controls, each centred on the title's first line whatever its
					    own height: the box is that line's height and lets them overhang. */}
							<div
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: 4,
									flexShrink: 0,
									height: TITLE_LINE_HEIGHT,
								}}
							>
								{dwell && dwell.level !== 'none' && (
									<span
										data-testid="ticket-dwell"
										data-dwell-level={dwell.level}
										title={`In this lane ${formatDuration(
											dwell.ms,
										)} — far longer than the rest of the column`}
										style={{
											display: 'inline-flex',
											alignItems: 'center',
											gap: 4,
											color: DWELL_COLOR[dwell.level],
											fontSize: 11,
											fontWeight: 600,
											lineHeight: 1,
											whiteSpace: 'nowrap',
											marginRight: 4,
										}}
									>
										<IconClock size={12} />
										<span>{formatDuration(dwell.ms)}</span>
									</span>
								)}

								{commentCount > 0 && (
									<IconButton
										testId="ticket-comments"
										title={`${commentCount} comment${
											commentCount === 1 ? '' : 's'
										}`}
										label={String(commentCount)}
										// Stopped here, or the click would also select the card.
										onClick={event => {
											event.stopPropagation();
											onOpenComments(ticket.id);
										}}
									>
										<IconComment size={ICON_SIZE} />
									</IconButton>
								)}
							</div>
						</div>

						{/* What identifies and measures it on one line, its tags at the
						    far end as on a dense card; where they do not fit, they wrap
						    under it rather than squeeze the ref and the name. */}
						{(goalLabel || ticket.ref || ticket.tags.length > 0) && (
							<div
								style={{
									display: 'flex',
									flexWrap: 'wrap',
									alignItems: 'center',
									columnGap: CARD_DIFF_GAP,
									rowGap: 6,
									minHeight: view.metrics.metaLineHeight,
									color: GUI_THEME.dim2,
									fontSize: 10,
								}}
							>
								{goalLabel}
								{ticket.ref && <CopyRef refValue={ticket.ref} />}
								<AssigneeName
									assignees={ticket.assignees}
									isolatedAssigneeId={isolatedAssigneeId}
									onFilterByAssignee={onFilterByAssignee}
								/>
								<DiffButton diff={diff} onOpen={() => onOpenCode(ticket.id)} />
								{ticket.tags.length > 0 && (
									<span
										style={{
											marginLeft: 'auto',
											display: 'flex',
											flexWrap: 'wrap',
											justifyContent: 'flex-end',
											gap: 6,
										}}
									>
										{ticket.tags.map(tag => {
											const isolated = tag.id === isolatedTagId;

											return (
												<Button
													key={tag.id}
													variant="chip"
													data-testid="ticket-tag"
													aria-pressed={isolated}
													tint={tag.color}
													held={isolated}
													dense
													title={
														isolated
															? 'Show every ticket again'
															: `Show only tickets tagged ${tag.name}`
													}
													// Stopped here, or the click would also select the card.
													onClick={event => {
														event.stopPropagation();
														onFilterByTag(tag.id);
													}}
													style={{color: tag.color}}
												>
													{tag.name}
												</Button>
											);
										})}
									</span>
								)}
							</div>
						)}
					</div>
				</>
			)}
		</div>
	);
};
