import {execGitAllowFail} from '../../git/git-utils.js';
import {EmailLink, isValidEmail, normalizeEmail} from '../model/email-link.js';
import {failed, isFail, Result, succeeded} from '../model/result-types.js';
import {scanCacheMs} from '../utils/cache-ttl.js';

/**
 * Unclaimed addresses in a repository's history, and whether each looks like
 * the asker's. Shared by the TUI and MCP; every link is made by a person.
 */

export type EmailCandidate = {
	email: string;
	/** The git author names seen with this address, for recognising it. */
	names: string[];
	commits: number;
	/** Whether anything about it matches the asker's name. */
	looksLikeYours: boolean;
	/** Contributors who already claim it, which is why it may not be offered. */
	claimedBy: string[];
};

// Two characters, since plenty of handles are that short.
const words = (value: string): string[] =>
	value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(word => word.length >= 2);

// Escaped, never literal: a raw control character makes the file binary to
// git and to grep, which the project lints against.
const FIELD = '\x1f';

type Seen = {names: Set<string>; commits: number};

const scanCache = new Map<string, {at: number; authors: Map<string, Seen>}>();

// The walk changes only with new commits, so it's cached and filtered fresh.
const SCAN_CACHE_MS = 15_000;

/** So one test's history does not answer the next one's scan. */
export const resetEmailScanCacheForTests = (): void => scanCache.clear();

/**
 * Every author in the history, by address, cached briefly. A failed scan is
 * an error, not an empty list.
 */
const scanAuthors = async (
	repoRoot: string,
	stateBranch?: string,
): Promise<Result<Map<string, Seen>>> => {
	const key = `${repoRoot} ${stateBranch ?? ''}`;
	const cached = scanCache.get(key);
	if (cached && Date.now() - cached.at < scanCacheMs(SCAN_CACHE_MS)) {
		return succeeded('Cached author scan', cached.authors);
	}

	const result = await execGitAllowFail({
		cwd: repoRoot,
		args: [
			'log',
			'--branches',
			...(stateBranch ? ['--not', stateBranch] : []),
			`--format=%an${FIELD}%ae`,
		],
	});

	if (result.exitCode !== 0) {
		return failed(
			`Could not read this repository's history: ${
				(result.stderr ?? '').trim() || `git exited ${result.exitCode}`
			}`,
		);
	}

	const authors = new Map<string, Seen>();

	for (const line of (result.stdout ?? '').split('\n')) {
		// The last separator: an author name may contain one.
		const at = line.lastIndexOf(FIELD);
		if (at === -1) continue;

		const name = line.slice(0, at);
		const email = normalizeEmail(line.slice(at + 1));
		if (!isValidEmail(email)) continue;

		const entry = authors.get(email) ?? {names: new Set<string>(), commits: 0};
		if (name) entry.names.add(name);
		entry.commits += 1;
		authors.set(email, entry);
	}

	scanCache.set(key, {at: Date.now(), authors});
	return succeeded('Scanned repository authors', authors);
};

export const findEmailCandidates = async ({
	repoRoot,
	stateBranch,
	names,
	links,
}: {
	repoRoot: string;
	/** Excluded from the scan, so the board's own log is not mistaken for work. */
	stateBranch?: string;
	/** Whatever the asker is called: their board name, their git name. */
	names: (string | null | undefined)[];
	links: Readonly<Record<string, EmailLink>>;
}): Promise<Result<EmailCandidate[]>> => {
	const scanned = await scanAuthors(repoRoot, stateBranch);
	if (isFail(scanned)) return failed(scanned.message);

	const seen = scanned.value;

	const claimants = new Map<string, Set<string>>();

	for (const link of Object.values(links)) {
		if (link.tombstoned) continue;
		const set = claimants.get(link.email) ?? new Set<string>();
		set.add(link.contributor);
		claimants.set(link.email, set);
	}

	const mine = new Set(names.flatMap(name => words(name ?? '')));

	return succeeded(
		'Found candidates',
		[...seen.entries()]
			.map(([email, entry]) => ({
				email,
				names: [...entry.names],
				commits: entry.commits,
				// The local part too, which catches `jola@` for jola where no commit
				// name would.
				looksLikeYours:
					[...entry.names].some(name =>
						words(name).some(word => mine.has(word)),
					) || words(email.split('@')[0] ?? '').some(word => mine.has(word)),
				claimedBy: [...(claimants.get(email) ?? [])],
			}))
			.sort((a, b) =>
				a.looksLikeYours === b.looksLikeYours
					? b.commits - a.commits
					: Number(b.looksLikeYours) - Number(a.looksLikeYours),
			),
	);
};

/** Unclaimed addresses, likely ones first; claimed ones are dropped. */
export const offerableCandidates = (
	candidates: EmailCandidate[],
): EmailCandidate[] =>
	candidates.filter(candidate => candidate.claimedBy.length === 0);
