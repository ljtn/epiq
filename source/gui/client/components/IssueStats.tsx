import {IssueStats as Stats} from '../../../lib/stats/issue-stats.model.js';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {
	percent,
	plural,
	relativeAge,
	ROW,
	shareOf,
	STAT_GRID,
	STAT_LABEL,
	STAT_NOTE,
	STAT_VALUE,
} from '../lib/issue-stats.style';
import {Empty} from './FormPrimitives';
import {Section} from './Section';

// What the ticket's own code says about itself, read as an answer to one
// question: how hard should somebody look at this diff, and where.
//
// So there is no score here, and there will not be one. A single number would
// be gamed within a week and would hide which of its inputs moved. What the
// page does instead is put each figure next to the thing it should be read
// against — the repo's own comment share, the lines that were never measured,
// the count that is a floor rather than a total — and let a reader draw the
// conclusion themselves.

const Stat = ({
	value,
	label,
	note,
}: {
	value: string;
	label: string;
	note?: string;
}) => (
	<div>
		<div style={STAT_VALUE}>{value}</div>
		<div style={STAT_LABEL}>{label}</div>
		{note && <div style={STAT_NOTE}>{note}</div>}
	</div>
);

const Row = ({left, right}: {left: string; right: string}) => (
	<div style={ROW}>
		<span style={{color: GUI_THEME.secondary}}>{left}</span>
		<span style={{color: GUI_THEME.primary}}>{right}</span>
	</div>
);

// A flag earns a line only when it has something to say. A page of zeroes
// reads as a checklist somebody has to work through; a page of three lines
// reads as three things to look at.
const Flag = ({when, children}: {when: boolean; children: string}) =>
	when ? (
		<div style={{...ROW, color: GUI_THEME.primary}}>
			<span>{children}</span>
		</div>
	) : null;

const CoverageSection = ({coverage}: {coverage: Stats['coverage']}) => {
	const measured = coverage.covered + coverage.uncovered;
	const unmeasured = coverage.notInstrumented + coverage.notInReport;

	return (
		<Section title="Coverage">
			{!coverage.anchored ? (
				<div style={STAT_NOTE}>{coverage.notAnchoredReason}</div>
			) : !coverage.report ? (
				<div style={STAT_NOTE}>
					No coverage report found. Epiq reads one your own toolchain writes
					(lcov) — put it at coverage/lcov.info, or name it in .epiq/stats.json.
				</div>
			) : (
				<>
					<div style={STAT_GRID}>
						<Stat
							value={shareOf(coverage.covered, measured)}
							label="Patch coverage"
							note={`${coverage.covered} of ${plural(
								measured,
								'measured line',
							)}`}
						/>
						<Stat
							value={String(unmeasured)}
							label="Lines not measured"
							note={`${coverage.notInstrumented} carry no record, ${coverage.notInReport} in files the report does not cover`}
						/>
						<Stat
							value={shareOf(
								coverage.report.totalCovered,
								coverage.report.totalLines,
							)}
							label="Repo coverage"
							note={coverage.report.path}
						/>
					</div>

					<div style={{...STAT_NOTE, marginTop: 12}}>
						{coverage.truncated
							? `Measured on ${coverage.survivingLines} lines, from the first files of a ticket too wide to read all of — a floor, not a total. `
							: `Measured on ${coverage.survivingLines} of the ${plural(
									coverage.linesAdded,
									'line',
							  )} this ticket added that still stand at HEAD, matched to the report by blame. `}
						{coverage.report.olderThanLastCommit
							? 'The report was written before this ticket’s last commit, so it predates the code it is being read against.'
							: `Report written ${relativeAge(
									coverage.report.modifiedAt,
									Date.now(),
							  )}.`}
					</div>

					{coverage.files
						.filter(file => file.inReport && file.uncovered > 0)
						.slice(0, 8)
						.map(file => (
							<Row
								key={file.path}
								left={file.path}
								right={`${plural(file.uncovered, 'line')} uncovered`}
							/>
						))}
				</>
			)}
		</Section>
	);
};

export const IssueStats = ({
	stats,
	loading,
	error,
}: {
	stats: Stats | null;
	loading: boolean;
	error: string | null;
}) => {
	if (error) return <Empty>{error}</Empty>;
	if (loading || !stats)
		return <Empty>Reading this ticket&rsquo;s code…</Empty>;

	const {shape, coverage, languages, tests, comments, flags} = stats;

	if (shape.commits === 0) {
		return (
			<Empty>
				No commit carries this ticket&rsquo;s ref, so there is no code to
				measure. That is not the same as no work.
			</Empty>
		);
	}

	return (
		<div style={{fontSize: TEXT.ui}}>
			<Section title="The change" first>
				<div style={STAT_GRID}>
					<Stat
						value={`+${shape.insertions} / −${shape.deletions}`}
						label="Lines"
						note={`net ${shape.net >= 0 ? '+' : ''}${shape.net}`}
					/>
					<Stat
						value={String(shape.files)}
						label="Files"
						note={`${shape.filesAdded} added, ${shape.filesModified} modified, ${shape.filesDeleted} deleted`}
					/>
					<Stat
						value={String(shape.directories)}
						label="Directories"
						note={`across ${plural(shape.commits, 'commit')}`}
					/>
					<Stat
						value={percent(shape.concentration)}
						label="In its largest file"
						note={shape.largestFile?.path}
					/>
				</div>

				{shape.selfChurn > 0 && (
					<div style={{...STAT_NOTE, marginTop: 12}}>
						{plural(shape.selfChurn, 'line')} the ticket wrote and then rewrote
						itself.
					</div>
				)}

				{shape.truncated && (
					<div style={{...STAT_NOTE, marginTop: 12}}>
						This ticket is large enough that the scan stopped early — every
						count here is a floor.
					</div>
				)}
			</Section>

			<Section title="Tests">
				<div style={STAT_GRID}>
					<Stat
						value={tests.ratio === null ? '—' : tests.ratio.toFixed(2)}
						label="Test lines per code line"
						note={`${tests.testLinesAdded} test, ${tests.codeLinesAdded} code`}
					/>
					<Stat
						value={tests.touchedTests ? 'Yes' : 'No'}
						label="Touched a test"
						note={
							tests.testFilesAdded > 0
								? `${plural(tests.testFilesAdded, 'test file')} added`
								: undefined
						}
					/>
				</div>

				<div style={{marginTop: 12}}>
					<Flag when={tests.testFilesDeleted > 0}>
						{`${plural(tests.testFilesDeleted, 'test file')} deleted`}
					</Flag>
					<Flag when={tests.testLinesRemoved > 0}>
						{`${plural(tests.testLinesRemoved, 'test line')} removed`}
					</Flag>
					<Flag when={tests.focusedTestLinesAdded > 0}>
						{`${plural(
							tests.focusedTestLinesAdded,
							'focused test',
						)} added — .only silences the rest of the suite`}
					</Flag>
					<Flag when={tests.skippedTestLinesAdded > 0}>
						{`${plural(tests.skippedTestLinesAdded, 'skipped test')} added`}
					</Flag>
				</div>
			</Section>

			<CoverageSection coverage={coverage} />

			<Section title="Languages">
				{languages.languages.map(language => (
					<Row
						key={language.name}
						left={language.name}
						right={`+${language.added} / −${language.removed}${
							language.addedInTests > 0
								? ` · ${language.addedInTests} in tests`
								: ''
						}`}
					/>
				))}

				{languages.introduced.length > 0 && (
					<div style={{...STAT_NOTE, marginTop: 12}}>
						New to this repository: {languages.introduced.join(', ')}.
					</div>
				)}

				{languages.generatedLines > 0 && (
					<div style={{...STAT_NOTE, marginTop: 12}}>
						{plural(languages.generatedLines, 'generated line')} excluded from
						every ratio above.
					</div>
				)}
			</Section>

			<Section title="Comments">
				<div style={STAT_GRID}>
					{comments.byLanguage.map(language => (
						<Stat
							key={language.name}
							value={shareOf(
								language.commentLines,
								language.commentLines + language.codeLines,
							)}
							label={`${language.name} comment lines`}
							note={
								language.repoShare === null
									? 'no repo baseline to compare with'
									: `repo: ${percent(language.repoShare)}`
							}
						/>
					))}
				</div>

				<div style={{marginTop: 12}}>
					<Flag when={comments.todoLinesAdded + comments.todoLinesRemoved > 0}>
						{`TODO/FIXME: ${comments.todoLinesAdded} added, ${comments.todoLinesRemoved} removed`}
					</Flag>
					<Flag when={comments.commentedOutCodeLines > 0}>
						{`${plural(
							comments.commentedOutCodeLines,
							'line',
						)} of commented-out code`}
					</Flag>
				</div>

				<div style={{...STAT_NOTE, marginTop: 12}}>
					Classified line by line — a diff carries no context to lex with — and
					shown against this repository&rsquo;s own share, which is the only
					reading of it worth anything.
				</div>
			</Section>

			<Section title="Worth a look">
				<Flag when={flags.dependencyManifests.length > 0}>
					{`Dependencies changed: ${flags.dependencyManifests.join(', ')}`}
				</Flag>
				<Flag when={flags.buildOrCiPaths.length > 0}>
					{`Build or CI changed: ${flags.buildOrCiPaths.join(', ')}`}
				</Flag>
				<Flag when={flags.generatedPaths.length > 0}>
					{`Generated files touched: ${flags.generatedPaths.join(', ')}`}
				</Flag>
				<Flag when={flags.debugPrintLinesAdded > 0}>
					{`${plural(flags.debugPrintLinesAdded, 'debug print')} added`}
				</Flag>
				<Flag when={flags.duplicatedLines > 0}>
					{`${plural(
						flags.duplicatedLines,
						'line',
					)} repeated across files in this change`}
				</Flag>
				<Flag when={flags.maxIndentLevels >= 6}>
					{`Nested ${flags.maxIndentLevels} levels deep at its deepest`}
				</Flag>
				<Flag when={shape.binaryFiles > 0}>
					{`${plural(shape.binaryFiles, 'binary file')} changed`}
				</Flag>

				{flags.dependencyManifests.length === 0 &&
					flags.buildOrCiPaths.length === 0 &&
					flags.generatedPaths.length === 0 &&
					flags.debugPrintLinesAdded === 0 &&
					flags.duplicatedLines === 0 &&
					flags.maxIndentLevels < 6 &&
					shape.binaryFiles === 0 && (
						<div style={STAT_NOTE}>Nothing flagged.</div>
					)}
			</Section>
		</div>
	);
};
