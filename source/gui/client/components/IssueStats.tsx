import {
	FilePointer,
	IssueStats as Stats,
} from '../../../lib/stats/issue-stats.model.js';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {plural} from '../lib/gui-format.helper';
import {
	LINE,
	percent,
	ROW,
	shortPath,
	STAT_CELL,
	statGrid,
	STAT_LABEL,
	STAT_NOTE,
	STAT_VALUE,
	COMMENT_YELLOW,
	inDays,
	seriesColor,
} from '../lib/issue-stats.style';
import {Breakdown, ProportionBar} from './StatBars';
import {BoardStats} from '../../../lib/stats/board-stats.js';
import {Empty} from './FormPrimitives';
import {Section} from './Section';
import {IconArrowUpRight} from './IconArrowUpRight';
import {IconButton, ICON_SIZE} from './IconButton';
import {Stat, StatRow} from './StatRow';

// What the ticket's code says about how hard to look at the diff, and where.
// No single score, and every path links into that file's diff.

const FileLink = ({
	file,
	onOpen,
	children,
}: {
	file: FilePointer;
	onOpen?: (file: FilePointer) => void;
	children?: string;
}) => {
	const label = children ?? shortPath(file.path);

	// No sha, nothing to open: plain text.
	if (!onOpen || !file.sha) {
		return <span title={file.path}>{label}</span>;
	}

	return (
		<button
			type="button"
			title={`${file.path} — open the diff`}
			onClick={() => onOpen(file)}
			style={{
				background: 'transparent',
				border: 'none',
				padding: 0,
				font: 'inherit',
				color: 'inherit',
				// Dotted, so it reads as a link without competing with the figure.
				textDecoration: 'underline dotted',
				textDecorationColor: GUI_THEME.dim2,
				textUnderlineOffset: 3,
				cursor: 'pointer',
				maxWidth: '100%',
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
			}}
			onMouseEnter={event => {
				event.currentTarget.style.color = GUI_THEME.accent;
			}}
			onMouseLeave={event => {
				event.currentTarget.style.color = 'inherit';
			}}
		>
			{label}
		</button>
	);
};

// The same link as an icon, for a square too small to spell the path out. The
// path is its tooltip and its name.
const FileLinkIcon = ({
	file,
	onOpen,
}: {
	file: FilePointer;
	onOpen?: (file: FilePointer) => void;
}) =>
	onOpen && file.sha ? (
		<IconButton
			title={`${file.path} — open the diff`}
			aria-label={`${file.path} — open the diff`}
			onClick={() => onOpen(file)}
		>
			<IconArrowUpRight size={ICON_SIZE} />
		</IconButton>
	) : null;

// A note shows only when it has something to say.
const Note = ({when, children}: {when: boolean; children: React.ReactNode}) =>
	when ? <div style={LINE}>{children}</div> : null;

/**
 * What the board has done with the ticket; how long it has sat where it is
 * tells hard from neglected. Meaningful even with no code.
 */
const BoardSection = ({
	boardStats,
	across,
	first = false,
}: {
	boardStats: BoardStats | null;
	across: number;
	first?: boolean;
}) =>
	boardStats ? (
		<Section title="Board" first={first}>
			<div style={statGrid(3, across)}>
				<Stat value={inDays(boardStats.ageMs)} label="Days old" />
				<Stat
					value={String(boardStats.timesSentBack)}
					label="Times sent back"
				/>
				<Stat
					value={inDays(boardStats.inLaneMs)}
					label={`Days in ${boardStats.laneTitle}`}
				/>
			</div>
		</Section>
	) : null;

export const IssueStats = ({
	stats,
	loading,
	error,
	onOpenFile,
	boardStats,
	activity,
	across = 4,
	of = 'ticket',
}: {
	stats: Stats | null;
	loading: boolean;
	error: string | null;
	// Opens a file's diff on the Code tab. Absent on a readonly board, where
	// there is still everything to read and nowhere to click to.
	onOpenFile?: (file: FilePointer) => void;
	// Null while the board has yet to arrive, or for a ticket no lane holds.
	boardStats: BoardStats | null;
	// How many stat squares fit across the panel.
	across?: number;
	// The ticket's own events, read with the Board figures they add up to.
	activity?: React.ReactNode;
	// What the stats are of, for the copy: one ticket, or a goal's.
	of?: 'ticket' | 'goal';
}) => {
	if (error) return <Empty>{error}</Empty>;
	if (loading || !stats) return <Empty>{`Reading this ${of}’s code…`}</Empty>;

	const {shape, languages, tests, comments, flags} = stats;

	// With no code, the board's figures are the whole story.
	if (shape.commits === 0) {
		return (
			<div style={{fontSize: TEXT.ui}}>
				<BoardSection boardStats={boardStats} across={across} first />
				{activity}

				<Section title="Code">
					<div style={LINE}>
						{of === 'goal'
							? 'No commit carries the ref of a ticket in this goal, so there is no code to measure.'
							: 'No commit carries this ticket’s ref, so there is no code to measure. That is not the same as no work.'}
					</div>
				</Section>
			</div>
		);
	}

	// The language the ticket is most written in — the one whose comment share
	// is worth drawing, since the rest are a handful of lines each.
	const leadComments = comments.byLanguage[0];

	const flaggedFiles = [
		...flags.dependencyManifests.map(file => ({file, what: 'dependencies'})),
		...flags.buildOrCiPaths.map(file => ({file, what: 'build or CI'})),
		...flags.generatedPaths.map(file => ({file, what: 'generated'})),
	];

	return (
		<div style={{fontSize: TEXT.ui}}>
			{/* First: the board's history frames how the code is read. */}
			<BoardSection boardStats={boardStats} across={across} first />
			{activity}

			<Section title="Code" first={!boardStats && !activity}>
				<div style={statGrid(4, across)}>
					<Stat
						value={String(shape.files)}
						label="Files touched"
						// The breakdown on hover; only what happened.
						title={[
							shape.filesAdded > 0 && `${shape.filesAdded} added`,
							shape.filesModified > 0 && `${shape.filesModified} modified`,
							shape.filesDeleted > 0 && `${shape.filesDeleted} deleted`,
						]
							.filter(Boolean)
							.join(' · ')}
					/>
					<Stat value={String(shape.directories)} label="Directories" />
					<Stat
						value={percent(shape.concentration)}
						label="In one file"
						title={shape.largestFile?.path}
						action={
							shape.largestFile && (
								<FileLinkIcon file={shape.largestFile} onOpen={onOpenFile} />
							)
						}
					/>
					{/* From the commits: who wrote the code, not who is assigned. */}
					<Stat
						value={String(shape.authors.length)}
						label={shape.authors.length === 1 ? 'Author' : 'Authors'}
					/>
				</div>

				<Note when={shape.selfChurn > 0}>
					{`${plural(shape.selfChurn, 'line')} rewritten more than once`}
				</Note>

				<Note when={shape.truncated}>
					{`This ${of} is large enough that the scan stopped early — every count here is a floor.`}
				</Note>
			</Section>

			<Section title="Tests">
				<div style={statGrid(2, across)}>
					<Stat value={String(tests.testLinesAdded)} label="Test lines added" />
					<Stat
						value={String(tests.addedTestFiles.length)}
						label={
							tests.addedTestFiles.length === 1
								? 'Test file added'
								: 'Test files added'
						}
						title={tests.addedTestFiles.map(file => file.path).join('\n')}
						// One beside the label; several in a row under it, where
						// they fit the square.
						action={
							tests.addedTestFiles.length === 1 && (
								<FileLinkIcon
									file={tests.addedTestFiles[0]!}
									onOpen={onOpenFile}
								/>
							)
						}
						note={
							tests.addedTestFiles.length > 1 && (
								<div style={{display: 'flex', gap: 2}}>
									{tests.addedTestFiles.slice(0, 3).map(file => (
										<FileLinkIcon
											key={file.path}
											file={file}
											onOpen={onOpenFile}
										/>
									))}
								</div>
							)
						}
					/>
				</div>

				<Note when={tests.deletedTestFiles.length > 0}>
					{`${plural(tests.deletedTestFiles.length, 'test file')} deleted: `}
					{tests.deletedTestFiles.map(file => (
						<span key={file.path}>
							<FileLink file={file} onOpen={onOpenFile} />{' '}
						</span>
					))}
				</Note>

				<Note when={tests.testLinesRemoved > 0}>
					{`${plural(tests.testLinesRemoved, 'test line')} removed`}
				</Note>

				<Note when={tests.focusedTestLinesAdded > 0}>
					{`${plural(
						tests.focusedTestLinesAdded,
						'focused test',
					)} added — .only silences the rest of the suite`}
				</Note>

				<Note when={tests.skippedTestLinesAdded > 0}>
					{`${plural(tests.skippedTestLinesAdded, 'skipped test')} added`}
				</Note>
			</Section>

			<Section title="Languages">
				<Breakdown
					testId="languages-toggle"
					items={languages.languages.map((language, index) => ({
						id: language.name,
						label: language.name,
						value: language.added + language.removed,
						color: seriesColor(index),
						amount: plural(language.added + language.removed, 'line'),
					}))}
				/>

				<Note when={languages.introduced.length > 0}>
					{`New to this repository: ${languages.introduced.join(', ')}`}
				</Note>
			</Section>

			<Section title="Comments">
				{/* One bar for the ticket's main language, with the repository's share marked. */}
				{leadComments && (
					<ProportionBar
						value={leadComments.share}
						// The diff's own comment colour; separation from the blue holds under protanopia.
						color={COMMENT_YELLOW}
						restColor={seriesColor(0)}
						label={`${percent(leadComments.share)} of the ${
							leadComments.name
						} lines this ${of} added are comments`}
						reference={leadComments.repoShare}
						referenceLabel={
							leadComments.repoShare === null
								? undefined
								: `This repository sits at ${percent(leadComments.repoShare)}`
						}
					/>
				)}

				{comments.byLanguage.map((language, index) => (
					<StatRow
						key={language.name}
						left={language.name}
						right={
							language.repoShare === null
								? percent(language.share)
								: `${percent(language.share)} · repo ${percent(
										language.repoShare,
								  )}`
						}
						last={index === comments.byLanguage.length - 1}
					/>
				))}

				<Note when={comments.todoLinesAdded + comments.todoLinesRemoved > 0}>
					{`TODO/FIXME: ${comments.todoLinesAdded} added, ${comments.todoLinesRemoved} removed`}
				</Note>

				<Note when={comments.commentedOutCodeLines > 0}>
					{`${plural(
						comments.commentedOutCodeLines,
						'line',
					)} of commented-out code`}
				</Note>
			</Section>

			<Section title="Complexity">
				<Note when={flags.maxIndentLevels > 0}>
					{`Nested ${flags.maxIndentLevels} levels deep at its deepest`}
					{flags.deepestFile && (
						<>
							{', in '}
							<FileLink file={flags.deepestFile} onOpen={onOpenFile} />
						</>
					)}
				</Note>

				<Note when={flags.duplicatedLines > 0}>
					{`${plural(
						flags.duplicatedLines,
						'line',
					)} repeated across files in this change`}
				</Note>

				<Note when={flags.debugPrintLinesAdded > 0}>
					{`${plural(flags.debugPrintLinesAdded, 'debug print')} added`}
				</Note>
			</Section>

			{(flaggedFiles.length > 0 || shape.binaryFiles > 0) && (
				<Section title="Worth a look">
					{flaggedFiles.map(({file, what}) => (
						<StatRow
							key={`${what}:${file.path}`}
							left={<FileLink file={file} onOpen={onOpenFile} />}
							right={what}
						/>
					))}

					<Note when={shape.binaryFiles > 0}>
						{`${plural(shape.binaryFiles, 'binary file')} changed`}
					</Note>
				</Section>
			)}
		</div>
	);
};
