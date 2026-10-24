// The ticket panel's Feature row. A ticket in a feature names it and can leave
// it; a feature lists its tickets and takes a colour; any other ticket can be
// put in one, picked from the features there are or from any ticket by title.

import React, {useState} from 'react';
import {useAddRow} from '../lib/use-add-row';
import {GUI_THEME} from '../lib/gui-theme';
import {GuiIssue} from '../lib/gui-state.model';
import {FeatureIndex, FeatureSummary} from '../lib/feature-index';
import {Button} from './Button';
import {AddRow, ChipRow, Empty, Input} from './FormPrimitives';
import {FeaturePill} from './FeaturePill';
import {IconCheck} from './IconCheck';
import {Section} from './Section';

const PICK_LIMIT = 8;

// The wheel at the saturation and lightness a name's own colour is drawn at,
// so a picked colour sits among tags and auto colours as one of them.
const SWATCHES = [
	'#cc6666',
	'#cc9966',
	'#cccc66',
	'#99cc66',
	'#66cc66',
	'#66cc99',
	'#66cccc',
	'#6699cc',
	'#6666cc',
	'#9966cc',
	'#cc66cc',
	'#cc6699',
];

const SWATCH_SIZE = 16;

const FeatureColors = ({
	color,
	autoColor,
	disabled,
	onPick,
}: {
	color?: string;
	autoColor: string;
	disabled: boolean;
	onPick: (color: string | null) => void;
}) => (
	<div
		data-testid="feature-colors"
		style={{
			display: 'flex',
			flexWrap: 'wrap',
			alignItems: 'center',
			gap: 6,
			padding: '6px 0 8px',
		}}
	>
		<Button
			variant="chip"
			dense
			testId="feature-color-auto"
			tint={color ? undefined : autoColor}
			held={!color}
			disabled={disabled}
			onClick={() => color && onPick(null)}
		>
			Auto
		</Button>
		{SWATCHES.map(swatch => {
			const held = color === swatch;

			return (
				<button
					key={swatch}
					type="button"
					data-testid={`feature-color-${swatch.slice(1)}`}
					aria-label={swatch}
					aria-pressed={held}
					disabled={disabled}
					onClick={() => !held && onPick(swatch)}
					style={{
						width: SWATCH_SIZE,
						height: SWATCH_SIZE,
						padding: 0,
						borderRadius: 999,
						borderWidth: 0,
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						color: GUI_THEME.bg,
						background: swatch,
						opacity: held || !color ? 1 : 0.55,
						cursor: disabled ? 'default' : 'pointer',
					}}
				>
					{held && <IconCheck size={11} />}
				</button>
			);
		})}
	</div>
);

const label = (issue: GuiIssue) => `${issue.ref} ${issue.title}`;

export const FeatureSection = ({
	issue,
	asFeature,
	features,
	candidates,
	onSetFeature,
	onSetColor,
	onOpenIssue,
}: {
	issue: GuiIssue;
	asFeature: FeatureSummary | null;
	features: FeatureIndex;
	// Every ticket there is, for the picker.
	candidates: GuiIssue[];
	onSetFeature: (issueId: string, feature: string | null) => void;
	onSetColor: (issueId: string, color: string | null) => void;
	onOpenIssue: (issueId: string) => void;
}) => {
	const row = useAddRow();
	const [query, setQuery] = useState('');
	const disabled = issue.readonly;

	// A feature opens to its colours; a ticket outside one, to the picker. A
	// ticket in a feature has its chip to leave it by.
	const canOpen = !disabled && (asFeature !== null || !issue.feature);
	const start = canOpen && !row.open ? row.start : undefined;
	const picking = row.open && !asFeature && !issue.feature;

	const needle = query.trim().toLowerCase();
	const matches = (candidate: GuiIssue) =>
		!needle || label(candidate).toLowerCase().includes(needle);

	const existing = candidates.filter(
		candidate =>
			features.has(candidate.id) &&
			candidate.id !== issue.id &&
			matches(candidate),
	);
	const others = needle
		? candidates.filter(
				candidate =>
					!features.has(candidate.id) &&
					!candidate.feature &&
					!candidate.isClosed &&
					candidate.id !== issue.id &&
					matches(candidate),
		  )
		: [];
	const options = [...existing, ...others].slice(0, PICK_LIMIT);

	const pick = (featureId: string) => {
		onSetFeature(issue.id, featureId);
		row.close();
		setQuery('');
	};

	return (
		<Section
			title="Feature"
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
			{asFeature ? (
				<>
					<ChipRow testId="feature-own-row" onActivate={start}>
						<FeaturePill
							testId="feature-own"
							strong
							color={asFeature.color}
							label={`Feature · ${asFeature.done}/${asFeature.members.length} done`}
						/>
					</ChipRow>
					{row.open && (
						<FeatureColors
							color={issue.color}
							autoColor={asFeature.color}
							disabled={disabled}
							onPick={color => onSetColor(issue.id, color)}
						/>
					)}
					<div
						data-testid="feature-members"
						style={{display: 'flex', flexDirection: 'column', gap: 2}}
					>
						{asFeature.members.map(member => (
							<button
								key={member.id}
								type="button"
								data-testid="feature-member"
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
			) : issue.feature ? (
				<ChipRow testId="feature-row">
					<Button
						variant="chip"
						disabled={disabled}
						tint={issue.feature.color}
						style={{color: issue.feature.color}}
						onClick={() => onSetFeature(issue.id, null)}
					>
						{issue.feature.title} {!disabled && '×'}
					</Button>
					<Button
						variant="ghost"
						onClick={() => onOpenIssue(issue.feature!.id)}
					>
						Open
					</Button>
				</ChipRow>
			) : (
				<ChipRow testId="feature-row">
					<Empty testId="feature-empty" onActivate={start}>
						No feature
					</Empty>
				</ChipRow>
			)}

			{picking && (
				<>
					<AddRow>
						<Input
							ref={row.inputRef}
							data-testid="feature-search"
							value={query}
							placeholder="Feature, or any ticket by title"
							onChange={event => setQuery(event.target.value)}
							onKeyDown={event => {
								if (event.key === 'Enter' && options[0]) pick(options[0].id);
								if (event.key === 'Escape') row.close();
							}}
						/>
					</AddRow>
					<ChipRow testId="feature-options">
						{options.length === 0 ? (
							<Empty>
								{needle ? 'No ticket matches' : 'Type to find a ticket'}
							</Empty>
						) : (
							options.map(option => {
								const color = features.get(option.id)?.color ?? GUI_THEME.dim;

								return (
									<Button
										key={option.id}
										variant="chip"
										tint={color}
										onClick={() => pick(option.id)}
										style={{color}}
									>
										+ {label(option)}
									</Button>
								);
							})
						)}
					</ChipRow>
				</>
			)}
		</Section>
	);
};
