// Finding and reading a coverage report the repository's own toolchain
// already produced.
//
// Epiq points at arbitrary repositories in arbitrary languages, so generating
// coverage is not on the table — that would mean knowing every test runner
// there is. This is bring-your-own-report and entirely opt-in: no report found
// means no coverage section, nothing enforced and nothing inferred.
//
// lcov only, for now. It is the closest thing to a universal format — emitted
// directly or convertible-to by most JS, Python, Ruby and Go toolchains — and
// the other formats (Istanbul JSON, Cobertura, JaCoCo, Go coverprofiles) parse
// with plain string scanning too, so adding one later is a parser and a line
// in the table below, not a redesign.

import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';

export type CoverageFormat = 'lcov';

export type CoverageReport = {
	// Repo-relative, as it will be shown to a reader.
	path: string;
	format: CoverageFormat;
	// When the report was written. A coverage report is a snapshot and goes
	// stale the moment anybody edits a file, so its age travels with it
	// everywhere rather than being looked up separately.
	modifiedAt: number;
	// path -> line -> hit count, with paths normalised to repo-relative.
	hitsByPath: Map<string, Map<number, number>>;
	// The report's own totals, across every file it covers — the repo-wide
	// number, as against anything about this ticket.
	totalLines: number;
	totalCovered: number;
};

// Ordered: the first that exists wins. Every entry is somewhere a common
// runner drops an lcov file with no configuration at all.
const CONVENTIONAL_PATHS = [
	'coverage/lcov.info',
	'coverage/lcov.dat',
	'coverage.lcov',
	'lcov.info',
	'.nyc_output/lcov.info',
	'htmlcov/lcov.info',
	'build/reports/lcov.info',
];

const STATS_CONFIG_PATH = '.epiq/stats.json';

const StatsConfigSchema = z.object({
	coverage: z
		.object({
			// Repo-relative path to an lcov report. Set this when the report
			// lives somewhere the list above does not reach.
			path: z.string().min(1).optional(),
		})
		.optional(),
});

/**
 * The configured path, if the repo has one. A malformed or absent config is
 * not an error: discovery falls back to the conventional paths, which is what
 * a repo with no config was always going to do.
 */
export const readConfiguredCoveragePath = (repoRoot: string): string | null => {
	try {
		const raw = fs.readFileSync(path.join(repoRoot, STATS_CONFIG_PATH), 'utf8');
		const parsed = StatsConfigSchema.safeParse(JSON.parse(raw) as unknown);

		return parsed.success ? parsed.data.coverage?.path ?? null : null;
	} catch {
		return null;
	}
};

const normalizeSourcePath = (raw: string, repoRoot: string): string => {
	const trimmed = raw.trim();

	// Report writers disagree about this: some write repo-relative paths, some
	// absolute ones, some prefix `./`. All three have to end up looking like
	// the paths git reports, or nothing will ever match.
	const relative = path.isAbsolute(trimmed)
		? path.relative(repoRoot, trimmed)
		: trimmed.replace(/^\.\//, '');

	return relative.split(path.sep).join('/');
};

export const parseLcov = (
	text: string,
	repoRoot: string,
): Pick<CoverageReport, 'hitsByPath' | 'totalLines' | 'totalCovered'> => {
	const hitsByPath = new Map<string, Map<number, number>>();

	let current: Map<number, number> | null = null;
	let totalLines = 0;
	let totalCovered = 0;

	for (const line of text.split('\n')) {
		if (line.startsWith('SF:')) {
			const file = normalizeSourcePath(line.slice(3), repoRoot);
			// A file listed twice (two runners, one report) merges rather than
			// replacing: a line covered by either run is covered.
			current = hitsByPath.get(file) ?? new Map<number, number>();
			hitsByPath.set(file, current);
			continue;
		}

		if (line.startsWith('DA:') && current) {
			const [rawLine, rawHits] = line.slice(3).split(',');
			const lineNumber = Number(rawLine);
			const hits = Number(rawHits);

			if (!Number.isFinite(lineNumber) || !Number.isFinite(hits)) continue;

			const existing = current.get(lineNumber);
			if (existing === undefined) {
				current.set(lineNumber, hits);
				totalLines++;
				if (hits > 0) totalCovered++;
				continue;
			}

			if (existing === 0 && hits > 0) totalCovered++;
			current.set(lineNumber, Math.max(existing, hits));
			continue;
		}

		if (line.startsWith('end_of_record')) current = null;
	}

	return {hitsByPath, totalLines, totalCovered};
};

/**
 * Null when there is nothing to read. Not a failure — most repositories have
 * no report, and the tab simply has no coverage section to show.
 */
export const discoverCoverageReport = (
	repoRoot: string,
): CoverageReport | null => {
	const configured = readConfiguredCoveragePath(repoRoot);
	const candidates = configured
		? [configured, ...CONVENTIONAL_PATHS]
		: CONVENTIONAL_PATHS;

	for (const candidate of candidates) {
		const absolute = path.join(repoRoot, candidate);

		try {
			const stat = fs.statSync(absolute);
			if (!stat.isFile()) continue;

			return {
				path: candidate,
				format: 'lcov',
				modifiedAt: stat.mtimeMs,
				...parseLcov(fs.readFileSync(absolute, 'utf8'), repoRoot),
			};
		} catch {
			continue;
		}
	}

	return null;
};
