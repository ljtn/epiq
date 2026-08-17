import {GuiContributor, GuiIssue, GuiTag} from '../lib/gui-state.model';
import {GUI_THEME} from '../lib/gui-theme';
import {Aside} from './Aside';
import {Button} from './Button';
import {ChipRow, Empty, Input, AddRow} from './FormPrimitives';
import {Section} from './Section';

// Counted so a chip can say whether it applies to the whole selection or only
// part of it — removing something half the tickets have needs to be visible.
const countBy = <T extends {id: string}>(
	issues: GuiIssue[],
	pick: (issue: GuiIssue) => T[],
) => {
	const byId = new Map<string, {item: T; count: number}>();

	for (const issue of issues) {
		for (const item of pick(issue)) {
			const seen = byId.get(item.id);
			byId.set(item.id, {item, count: (seen?.count ?? 0) + 1});
		}
	}

	return [...byId.values()];
};

export const BulkDetails = ({
	issues,
	knownTags,
	knownAssignees,
	tagName,
	assigneeName,
	onChangeTagName,
	onChangeAssigneeName,
	onAddTag,
	onRemoveTag,
	onAddAssignee,
	onRemoveAssignee,
	onCloseIssues,
	onReopenIssues,
	onClear,
}: {
	issues: GuiIssue[];
	knownTags: GuiTag[];
	knownAssignees: GuiContributor[];
	tagName: string;
	assigneeName: string;
	onChangeTagName: (value: string) => void;
	onChangeAssigneeName: (value: string) => void;
	onAddTag: (tagName: string) => void;
	onRemoveTag: (tagId: string) => void;
	onAddAssignee: (assigneeId: string) => void;
	onRemoveAssignee: (assigneeId: string) => void;
	onCloseIssues: () => void;
	onReopenIssues: () => void;
	onClear: () => void;
}) => {
	const total = issues.length;
	const tags = countBy(issues, issue => issue.tags);
	const assignees = countBy(issues, issue => issue.assignees);

	const availableTags = knownTags.filter(
		tag =>
			!tags.some(entry => entry.item.id === tag.id && entry.count === total),
	);
	const availableAssignees = knownAssignees.filter(
		person =>
			!assignees.some(
				entry => entry.item.id === person.id && entry.count === total,
			),
	);

	const partial = (count: number) =>
		count === total ? '' : ` ${count}/${total}`;

	return (
		<Aside>
			<div
				style={{
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: 8,
					marginBottom: 12,
				}}
			>
				<div style={{fontSize: 13, fontWeight: 600, color: GUI_THEME.primary}}>
					{total} tickets selected
				</div>
				<Button variant="ghost" onClick={onClear}>
					clear
				</Button>
			</div>

			<Section title="Tags">
				<ChipRow>
					{tags.length === 0 ? (
						<Empty>No tags</Empty>
					) : (
						tags.map(({item, count}) => (
							<Button
								key={item.id}
								variant="chip"
								title="Remove from every selected ticket"
								onClick={() => onRemoveTag(item.id)}
								style={{color: item.color}}
							>
								{item.name}
								{partial(count)} ×
							</Button>
						))
					)}
				</ChipRow>

				<ChipRow>
					{availableTags.map(tag => (
						<Button
							key={tag.id}
							variant="chip"
							title="Add to every selected ticket"
							onClick={() => onAddTag(tag.name)}
							style={{color: tag.color, opacity: 0.6}}
						>
							+ {tag.name}
						</Button>
					))}
				</ChipRow>

				<AddRow>
					<Input
						value={tagName}
						placeholder="new tag"
						onChange={event => onChangeTagName(event.target.value)}
						onKeyDown={event => {
							if (event.key === 'Enter' && tagName.trim()) {
								onAddTag(tagName.trim());
							}
						}}
					/>
					<Button onClick={() => tagName.trim() && onAddTag(tagName.trim())}>
						add
					</Button>
				</AddRow>
			</Section>

			<Section title="Assignees">
				<ChipRow>
					{assignees.length === 0 ? (
						<Empty>No assignees</Empty>
					) : (
						assignees.map(({item, count}) => (
							<Button
								key={item.id}
								variant="chip"
								title="Remove from every selected ticket"
								onClick={() => onRemoveAssignee(item.id)}
								style={{color: item.color}}
							>
								@{item.name}
								{partial(count)} ×
							</Button>
						))
					)}
				</ChipRow>

				<ChipRow>
					{availableAssignees.map(person => (
						<Button
							key={person.id}
							variant="chip"
							title="Add to every selected ticket"
							onClick={() => onAddAssignee(person.id)}
							style={{color: person.color, opacity: 0.6}}
						>
							+ @{person.isSelf ? 'me' : person.name}
						</Button>
					))}
				</ChipRow>

				<AddRow>
					<Input
						value={assigneeName}
						placeholder="name of unknown contributor"
						onChange={event => onChangeAssigneeName(event.target.value)}
					/>
				</AddRow>
			</Section>

			<Section title="Actions">
				<ChipRow>
					<Button onClick={onCloseIssues}>close {total} tickets</Button>
					<Button onClick={onReopenIssues}>reopen {total} tickets</Button>
				</ChipRow>
			</Section>
		</Aside>
	);
};
