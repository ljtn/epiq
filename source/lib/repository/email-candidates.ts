import {execGitAllowFail} from '../../git/git-utils.js';
import {EmailLink, normalizeEmail} from '../model/email-link.js';

/**
 * Addresses in a repository's history that nobody has claimed, and whether each
 * looks like it belongs to the person asking.
 *
 * Here rather than in `mcp/api` because the TUI's setup step and the MCP tool
 * have to offer the same list. Two scanners would mean two answers to "which of
 * these are mine", and the one the user was shown would depend on where they
 * happened to be standing.
 *
 * This is the only way an address gets claimed now. Nothing links unattended,
 * so every link has a person behind it who saw the address, the name on it and
 * how many commits it authored.
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

// Two characters, not three: plenty of people go by a handle that short, and a
// longer floor matched nothing at all for exactly those users. Every candidate
// is confirmed by a person, so a loose token costs a glance.
const words = (value: string): string[] =>
	value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(word => word.length >= 2);

// Escaped, never literal: a raw control character makes the file binary to
// git and to grep, which the project lints against.
const FIELD = '\x1f';

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
}): Promise<EmailCandidate[]> => {
	const result = await execGitAllowFail({
		cwd: repoRoot,
		args: [
			'log',
			'--branches',
			...(stateBranch ? ['--not', stateBranch] : []),
			`--format=%an${FIELD}%ae`,
		],
	});

	if (result.exitCode !== 0) return [];

	const claimants = new Map<string, Set<string>>();

	for (const link of Object.values(links)) {
		if (link.tombstoned) continue;
		const set = claimants.get(link.email) ?? new Set<string>();
		set.add(link.contributor);
		claimants.set(link.email, set);
	}

	const seen = new Map<string, {names: Set<string>; commits: number}>();

	for (const line of (result.stdout ?? '').split('\n')) {
		const [name, rawEmail] = line.split(FIELD);
		const email = normalizeEmail(rawEmail ?? '');
		if (!email) continue;

		const entry = seen.get(email) ?? {names: new Set<string>(), commits: 0};
		if (name) entry.names.add(name);
		entry.commits += 1;
		seen.set(email, entry);
	}

	const mine = new Set(names.flatMap(name => words(name ?? '')));

	return [...seen.entries()]
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
		);
};

/**
 * What to put in front of somebody: unclaimed addresses, likely ones first.
 *
 * Addresses already claimed are dropped rather than shown greyed out. Offering
 * one would be offering to make it contested, which is the state this whole
 * feature exists to avoid walking into by accident.
 */
export const offerableCandidates = (
	candidates: EmailCandidate[],
): EmailCandidate[] =>
	candidates.filter(candidate => candidate.claimedBy.length === 0);
