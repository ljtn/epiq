import {
	FilePointer,
	IssueStats as Stats,
} from '../../../lib/stats/issue-stats.model.js';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {
	LINE,
	percent,
	plural,
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
import {ProportionBar, StackedBar} from './StatBars';
import {BoardStats} from '../../../lib/stats/board-stats.js';
import {Empty} from './FormPrimitives';
import {Section} from './Section';

// What the ticket's own code says about itself, read as an answer to one
// question: how hard should somebody look at this diff, and where.
//
// Two rules hold the page together. There is no score — a single number would
// be gamed within a week and would hide which of its inputs moved. And every
// path on the page is a link into that file's diff, so "22% of this change is
// in one file" is somewhere to go rather than something to know.

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

	// No sha means the scan never saw which commit last touched it, which
	// leaves nothing to open — so it stays text rather than becoming a link
	// that goes nowhere.
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
				// Dotted rather than solid: at this size a solid rule reads as
				// part of the text, and these sit among figures that are not
				// links. Enough to say "this goes somewhere", quiet enough not to
				// compete with the number above it.
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

const Stat = ({
	value,
	label,
	note,
}: {
	value: string;
	label: string;
	note?: React.ReactNode;
}) => (
	<div
		style={STAT_CELL}
		// The same lift every hoverable surface in the app takes, so a figure
		// under the pointer separates from the four beside it — and a path in
		// the note below reads as part of that block rather than as loose text.
		onMouseEnter={event => {
			event.currentTarget.style.background = GUI_THEME.hover;
		}}
		onMouseLeave={event => {
			event.currentTarget.style.background = 'transparent';
		}}
	>
		<div style={STAT_VALUE}>{value}</div>
		<div style={STAT_LABEL}>{label}</div>
		{note && <div style={STAT_NOTE}>{note}</div>}
	</div>
);

const Row = ({
	left,
	right,
	dot,
	last = false,
}: {
	left: React.ReactNode;
	right: string;
	dot?: string;
	// The section below draws its own top border, so a rule under the final row
	// is that border twice.
	last?: boolean;
}) => (
	<div style={last ? {...ROW, borderBottom: 'none'} : ROW}>
		<span
			style={{
				display: 'flex',
				alignItems: 'center',
				gap: 8,
				color: GUI_THEME.secondary,
				minWidth: 0,
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
			}}
		>
			{dot && (
				// The bar above says which share is which by position; this says
				// it again by name, so the reading never rests on colour alone.
				<span
					aria-hidden
					style={{
						width: 7,
						height: 7,
						borderRadius: 2,
						background: dot,
						flexShrink: 0,
					}}
				/>
			)}
			{left}
		</span>
		<span style={{color: GUI_THEME.primary, flexShrink: 0}}>{right}</span>
	</div>
);

// A note earns a line only when it has something to say. A page of zeroes
// reads as a checklist somebody has to work through; three lines read as
// three things to look at.
const Note = ({when, children}: {when: boolean; children: React.ReactNode}) =>
	when ? <div style={LINE}>{children}</div> : null;

/**
 * The other half of a ticket: not what the code says, but what the board has
 * done with it. A ticket can be old because it is hard or because nobody
 * looked at it, and the third figure — how long it has sat where it is now —
 * is what separates the two.
 *
 * Its own component because it is the one section that still means something
 * for a ticket with no code at all. That is, in fact, when it means most.
 */
const BoardSection = ({
	boardStats,
	compact,
	first = false,
}: {
	boardStats: BoardStats | null;
	compact: boolean;
	first?: boolean;
}) =>
	boardStats ? (
		<Section title="Board" first={first}>
			<div style={statGrid(compact)}>
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
	compact = false,
}: {
	stats: Stats | null;
	loading: boolean;
	error: string | null;
	// Opens a file's diff on the Commits tab. Absent on a readonly board, where
	// there is still everything to read and nowhere to click to.
	onOpenFile?: (file: FilePointer) => void;
	// Null while the board has yet to arrive, or for a ticket no lane holds.
	boardStats: BoardStats | null;
	// The panel is too narrow for four figures across.
	compact?: boolean;
}) => {
	if (error) return <Empty>{error}</Empty>;
	if (loading || !stats)
		return <Empty>Reading this ticket&rsquo;s code…</Empty>;

	const {shape, languages, tests, comments, flags} = stats;

	// No code yet is not nothing to say: how long a ticket has been open, and
	// how long it has sat where it is, is the whole story of one that has not
	// been started.
	if (shape.commits === 0) {
		return (
			<div style={{fontSize: TEXT.ui}}>
				<BoardSection boardStats={boardStats} compact={compact} first />

				<Section title="Code">
					<div style={LINE}>
						No commit carries this ticket&rsquo;s ref, so there is no code to
						measure. That is not the same as no work.
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
			{/* First: what the board has done with a ticket is the frame the
			    code is read in — whether this change is a week old and still
			    moving, or has been sent back twice already. */}
			<BoardSection boardStats={boardStats} compact={compact} first />

			<Section title="Code">
				<div style={statGrid(compact)}>
					<Stat
						value={String(shape.files)}
						label="Files"
						// Only what happened: "0 deleted" is a line of noise that
						// wraps the note onto two lines in a narrow panel.
						note={[
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
						note={
							shape.largestFile && (
								<FileLink file={shape.largestFile} onOpen={onOpenFile} />
							)
						}
					/>
					{/* Off the commits, not off the board: who is assigned a ticket
					    and who actually wrote its code are different questions, and
					    this is the second one. */}
					<Stat
						value={String(shape.authors.length)}
						label={shape.authors.length === 1 ? 'Author' : 'Authors'}
					/>
				</div>

				<Note when={shape.selfChurn > 0}>
					{`${plural(shape.selfChurn, 'line')} rewritten more than once`}
				</Note>

				<Note when={shape.truncated}>
					This ticket is large enough that the scan stopped early — every count
					here is a floor.
				</Note>
			</Section>

			<Section title="Tests">
				<div style={statGrid(compact)}>
					<Stat value={String(tests.testLinesAdded)} label="Test lines added" />
					<Stat
						value={String(tests.addedTestFiles.length)}
						label={
							tests.addedTestFiles.length === 1
								? 'Test file added'
								: 'Test files added'
						}
						note={tests.addedTestFiles.slice(0, 3).map(file => (
							<div key={file.path}>
								<FileLink file={file} onOpen={onOpenFile} />
							</div>
						))}
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
				<StackedBar
					segments={languages.languages.map((language, index) => ({
						label: language.name,
						value: language.added + language.removed,
						color: seriesColor(index),
					}))}
				/>

				{languages.languages.map((language, index) => (
					<Row
						key={language.name}
						dot={seriesColor(index)}
						left={language.name}
						right={percent(language.share)}
						last={index === languages.languages.length - 1}
					/>
				))}

				<Note when={languages.introduced.length > 0}>
					{`New to this repository: ${languages.introduced.join(', ')}`}
				</Note>
			</Section>

			<Section title="Comments">
				{/* One bar, for the language the ticket is mostly written in, with
				    the repository's own share marked on it. A bar per language
				    turned three true numbers into a wall of stripes, and the
				    comparison — this change against this codebase — is the only
				    reading of a comment share worth anything. */}
				{leadComments && (
					<ProportionBar
						value={leadComments.share}
						// Yellow for the prose, blue for the code it explains — the
						// very value the diff paints a comment with, so the bar and the
						// file agree about which is which. Brighter than a categorical
						// slot is allowed to be, which is the right call for two
						// segments that are named underneath and separated by a gap:
						// what binds here is separation from the blue (ΔE 37.7 under
						// protanopia) and contrast against the panel, and both pass.
						color={COMMENT_YELLOW}
						restColor={seriesColor(0)}
						label={`${percent(leadComments.share)} of the ${
							leadComments.name
						} lines this ticket added are comments`}
						reference={leadComments.repoShare}
						referenceLabel={
							leadComments.repoShare === null
								? undefined
								: `This repository sits at ${percent(leadComments.repoShare)}`
						}
					/>
				)}

				{comments.byLanguage.map((language, index) => (
					<Row
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
						<Row
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
