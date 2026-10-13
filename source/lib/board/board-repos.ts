import {createHash} from 'node:crypto';
import {failed, Result, succeeded} from '../model/result-types.js';
import {isAllowedRepoUrl} from '../commits/repo-url.js';

// The other repositories whose commits count as this board's, kept as board
// events so they sync with the board and never conflict. One reducer applies
// those events, both to the board state and to the live list readers fold
// from the whole log; nothing else decides what an event did.
//
// Only rules that will never change belong here: a rule a later build may
// relax or tighten is applied by readers instead (`resolveRepos`), or two
// builds would derive different lists from one log.

export type RepoBranches = 'default' | 'all';

/** `board` (when the board was created), `all`, or a `YYYY-MM-DD` date. */
export type RepoSince = string;

export type CommitRepo = {
	/** Stable across machines: derived from the URL alone. */
	id: string;
	url: string;
	branches: RepoBranches;
	since: RepoSince;
	/** What the repo is called on the board. */
	label: string;
};

export type RepoEntry = {
	id: string;
	url: string;
	branches: RepoBranches;
	since: RepoSince;
	/** A label someone set; the URL's basename stands in otherwise. */
	label?: string;
	live: boolean;
	/** Where in causal order it last became live; earlier wins the cap and a label. */
	seq: number;
};

/**
 * Every repo a log has named, by id, and the last `seq` given out. Updated in
 * place by `applyRepoEvent`, so a log of any length folds in linear time: its
 * owner is the fold, or the board state, and nothing else holds it.
 */
export type RepoRegistry = {entries: Record<string, RepoEntry>; seq: number};

export const emptyRepoRegistry = (): RepoRegistry => ({entries: {}, seq: 0});

/**
 * What a connect that leaves a field out gets, on a new or revived repo. Part
 * of the log's format, apart from any default a writer offers: changing these
 * would rewrite what every connect already in a log means.
 */
export const FOLD_DEFAULT_BRANCHES: RepoBranches = 'default';
export const FOLD_DEFAULT_SINCE: RepoSince = 'board';

/** How many repos a board reads. Applied by readers, so it can change. */
export const MAX_REPOS = 20;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Short, lowercase, nothing a command line splits on or a chip would wrap.
const LABEL = /^[a-z0-9][a-z0-9._-]{0,23}$/;
// How an id ends. A label never looks like one: a repo is named by either.
const ID_HASH = /-[0-9a-f]{12}$/;

export const isRepoSince = (value: string): boolean =>
	value === 'board' || value === 'all' || isCalendarDate(value);

// A day that exists, from 1970 on: `Date` rolls 2025-02-30 into March.
const isCalendarDate = (value: string): boolean => {
	if (!DATE.test(value) || value < '1970-01-01') return false;
	const parsed = new Date(`${value}T00:00:00Z`);

	return (
		!Number.isNaN(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
};

export const isRepoLabel = (value: string): boolean =>
	LABEL.test(value) && !ID_HASH.test(value);

// `user@host:path`, the form ssh remotes are usually written in.
const SCP_URL = /^([^@/]+@)([^:/]+)(:.*)$/;
const SCHEME_URL = /^([a-z][a-z0-9+.-]*:\/\/)([^/]*)(.*)$/i;

// Case folded only where it means nothing: the scheme and the host. A path
// keeps its case, which a case-sensitive host or file system goes by.
const foldCase = (url: string): string => {
	const scp = SCP_URL.exec(url);
	if (scp) return `${scp[1]}${scp[2]!.toLowerCase()}${scp[3]}`;

	const scheme = SCHEME_URL.exec(url);
	if (!scheme) return url;

	const authority = scheme[2]!;
	const at = authority.lastIndexOf('@') + 1;
	return `${scheme[1]!.toLowerCase()}${authority.slice(0, at)}${authority
		.slice(at)
		.toLowerCase()}${scheme[3]}`;
};

const normalizeUrl = (url: string): string =>
	foldCase(
		url
			.trim()
			.replace(/\/+$/, '')
			.replace(/\.git$/i, ''),
	);

/** What a repo is called unless a label says otherwise: its URL's basename. */
export const repoLabelOfUrl = (url: string): string => {
	const last =
		normalizeUrl(url).toLowerCase().split(/[/:]/).filter(Boolean).pop() ?? '';
	// Short: it names a directory, and Windows caps a whole path at 260.
	const slug = last.replace(/[^a-z0-9._-]/g, '-').slice(0, 24);

	return slug.replace(/^[.-]+/, '') || 'repo';
};

/** Part of the log's format: every event names a repo by this. */
export const repoIdOf = (url: string): string =>
	`${repoLabelOfUrl(url)}-${createHash('sha1')
		.update(normalizeUrl(url))
		.digest('hex')
		.slice(0, 12)}`;

/** The label back off an id, which carries it ahead of the URL's hash. */
export const repoLabelOfId = (repoId: string): string =>
	repoId.replace(ID_HASH, '');

type RepoFields = {
	branches?: RepoBranches;
	since?: RepoSince;
	/** Empty clears it. */
	label?: string;
};

// Each field on its own: one this build cannot read is left out, not the event.
const readFields = (payload: Record<string, unknown>): RepoFields => {
	const fields: RepoFields = {};
	const {branches, since, label} = payload;

	if (branches === 'default' || branches === 'all') fields.branches = branches;
	if (typeof since === 'string' && isRepoSince(since)) fields.since = since;
	if (typeof label === 'string' && (label === '' || isRepoLabel(label))) {
		fields.label = label;
	}

	return fields;
};

const withFields = (entry: RepoEntry, fields: RepoFields): RepoEntry => {
	const next: RepoEntry = {
		...entry,
		...(fields.branches ? {branches: fields.branches} : {}),
		...(fields.since ? {since: fields.since} : {}),
	};

	if (fields.label === '') delete next.label;
	else if (fields.label) next.label = fields.label;

	return next;
};

type RepoEvent =
	| {action: 'connect.repo'; payload: unknown}
	| {action: 'edit.repo'; payload: unknown}
	| {action: 'disconnect.repo'; payload: unknown};

/**
 * One repo event applied to the registry, or why it changes nothing, in which
 * case the registry is left as it was. Total: any payload at all is an answer,
 * never a throw.
 *
 * A connect of a live repo merges its fields, last writer in causal order
 * winning, so two people connecting one repo at once both keep what they set.
 * An edit or disconnect of a repo that is not live changes nothing, so one
 * that raced a disconnect never brings the repo back.
 */
export const applyRepoEvent = (
	registry: RepoRegistry,
	event: RepoEvent,
): Result<RepoEntry> => {
	const payload =
		event.payload && typeof event.payload === 'object'
			? (event.payload as Record<string, unknown>)
			: {};
	const fields = readFields(payload);

	if (event.action === 'connect.repo') {
		// Any URL is folded: which ones are read is the readers' rule, and it
		// may change, while what a log holds must not.
		const url = typeof payload['url'] === 'string' ? payload['url'].trim() : '';
		if (url === '') return failed('no URL');

		const id = repoIdOf(url);
		const existing = Object.hasOwn(registry.entries, id)
			? registry.entries[id]
			: undefined;

		const entry =
			existing?.live === true
				? withFields(existing, fields)
				: // Revived as the connect describes it, not as it was left.
				  withFields(
						{
							id,
							url,
							branches: FOLD_DEFAULT_BRANCHES,
							since: FOLD_DEFAULT_SINCE,
							live: true,
							seq: registry.seq + 1,
						},
						fields,
				  );

		if (!existing?.live) registry.seq++;
		registry.entries[id] = entry;
		return succeeded('Connected repo', entry);
	}

	const id = typeof payload['repo'] === 'string' ? payload['repo'] : '';
	const existing = Object.hasOwn(registry.entries, id)
		? registry.entries[id]
		: undefined;
	if (!existing?.live) return failed('no such connected repo');

	if (event.action === 'disconnect.repo') {
		const entry: RepoEntry = {...existing, live: false};
		registry.entries[id] = entry;
		return succeeded('Disconnected repo', entry);
	}

	if (Object.keys(fields).length === 0) {
		return failed('nothing this build reads to change');
	}

	const entry = withFields(existing, fields);
	registry.entries[id] = entry;
	return succeeded('Edited repo', entry);
};

export const isRepoAction = (action: string): action is RepoEvent['action'] =>
	action === 'connect.repo' ||
	action === 'edit.repo' ||
	action === 'disconnect.repo';

/** The registry a causally ordered log comes to. */
export const foldRepoEvents = (
	events: readonly {action: string; payload: unknown}[],
): RepoRegistry => {
	const registry = emptyRepoRegistry();

	for (const event of events) {
		if (!isRepoAction(event.action)) continue;
		applyRepoEvent(registry, {action: event.action, payload: event.payload});
	}

	return registry;
};

export type ResolvedRepos = {
	/** What the board reads: the first `MAX_REPOS` to become live. */
	live: CommitRepo[];
	/** Live past the cap: listed, never fetched. */
	overLimit: CommitRepo[];
	/** Ids a disconnect left, whose clones may go. */
	disconnected: string[];
};

/**
 * The registry as readers see it. The cap and a contested name are settled
 * here rather than in the reducer, so a later build may change either without
 * disagreeing with this one about the log: the earliest to become live keeps a
 * name, and a later one is called by its URL's basename, or else its id.
 */
export const resolveRepos = (registry: RepoRegistry): ResolvedRepos => {
	const entries = Object.values(registry.entries);
	const live = entries
		.filter(entry => entry.live && isAllowedRepoUrl(entry.url))
		.sort((a, b) => a.seq - b.seq);

	// Every name shown is one no repo ahead of it shows: its own label, else
	// its URL's basename, else its id, which nothing else can be called.
	const taken = new Set<string>();
	const repos = live.map((entry): CommitRepo => {
		const label =
			[entry.label, repoLabelOfUrl(entry.url)].find(
				name => name !== undefined && !taken.has(name),
			) ?? entry.id;
		taken.add(label);

		return {
			id: entry.id,
			url: entry.url,
			branches: entry.branches,
			since: entry.since,
			label,
		};
	});

	return {
		live: repos.slice(0, MAX_REPOS),
		overLimit: repos.slice(MAX_REPOS),
		disconnected: entries.filter(entry => !entry.live).map(entry => entry.id),
	};
};
