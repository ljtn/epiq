import type {
	Release,
	ReleaseSection,
	UpdateInfo,
	VersionStatus,
} from './version.model.js';

export type {Release, ReleaseSection, UpdateInfo, VersionStatus};

const NPM_LATEST_URL = 'https://registry.npmjs.org/epiq/latest';
const RELEASES_URL =
	'https://api.github.com/repos/ljtn/epiq/releases?per_page=30';
const INSTALL_SCRIPT_URL =
	'https://raw.githubusercontent.com/ljtn/epiq/main/install.sh';

// Best effort and rare: an answer is kept a day, a failure an hour, and every
// caller in between shares the one request.
const CACHE_MS = 1000 * 60 * 60 * 24;
const RETRY_MS = 1000 * 60 * 60;
const TIMEOUT_MS = 5000;

const responses = new Map<string, {at: number; ttl: number; body: unknown}>();
const inFlight = new Map<string, Promise<unknown>>();

export const clearUpdateCache = () => {
	responses.clear();
	inFlight.clear();
};

// A stray-dot tag such as `v.1.3.2` must not rank above every real one.
const STRICT_VERSION = /^v?\d+\.\d+\.\d+$/;

const normalizeVersion = (version: string) => version.replace(/^v/, '');

export const compareVersions = (a: string, b: string) => {
	const aParts = normalizeVersion(a).split('.').map(Number);
	const bParts = normalizeVersion(b).split('.').map(Number);

	for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
		const aPart = aParts[i] ?? 0;
		const bPart = bParts[i] ?? 0;

		if (aPart > bPart) return 1;
		if (aPart < bPart) return -1;
	}

	return 0;
};

const checksDisabled = () =>
	process.env['IS_CI'] === 'true' ||
	process.env['EPIQ_NO_UPDATE_CHECK'] === '1';

const fetchJson = async (url: string): Promise<unknown> => {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: {accept: 'application/json'},
		});
		return response.ok ? await response.json() : null;
	} catch {
		return null;
	}
};

/**
 * The JSON at `url`, or null on any failure; never throws. An answer that is
 * not yet `complete` is retried as soon as a failure would be.
 */
const cachedJson = (
	url: string,
	complete: (body: unknown) => boolean = () => true,
): Promise<unknown> => {
	const cached = responses.get(url);
	if (cached && Date.now() - cached.at < cached.ttl) {
		return Promise.resolve(cached.body);
	}

	const pending = inFlight.get(url);
	if (pending) return pending;

	const request = fetchJson(url).then(body => {
		responses.set(url, {
			at: Date.now(),
			ttl: body !== null && complete(body) ? CACHE_MS : RETRY_MS,
			body,
		});
		inFlight.delete(url);
		return body;
	});
	inFlight.set(url, request);

	return request;
};

export const getVersionStatus = async (
	current: string,
): Promise<VersionStatus> => {
	if (checksDisabled()) {
		return {current, latest: null, updateAvailable: false};
	}

	const pkg = (await cachedJson(NPM_LATEST_URL)) as {
		version?: unknown;
	} | null;
	const latest =
		typeof pkg?.version === 'string' && STRICT_VERSION.test(pkg.version)
			? pkg.version
			: null;

	return {
		current,
		latest,
		updateAvailable: latest ? compareVersions(latest, current) > 0 : false,
	};
};

/**
 * A release body: a version line, then title lines over `- ` bullets, which
 * may continue on indented lines.
 */
export const parseReleaseNotes = (body: string): ReleaseSection[] => {
	const sections: ReleaseSection[] = [];
	let section: ReleaseSection | null = null;

	for (const raw of body.replace(/\r/g, '').split('\n')) {
		const line = raw.trimEnd();
		if (!line.trim()) continue;

		if (/^[-*] /.test(line.trimStart()) && !/^\s{2,}/.test(line)) {
			if (!section) {
				section = {title: null, items: []};
				sections.push(section);
			}

			section.items.push(line.trimStart().slice(2).trim());
		} else if (/^\s+/.test(line) && section?.items.length) {
			section.items[section.items.length - 1] += ` ${line.trim()}`;
		} else if (STRICT_VERSION.test(line.trim()) && sections.length === 0) {
			continue;
		} else {
			section = {title: line.replace(/^#+\s*/, '').trim(), items: []};
			sections.push(section);
		}
	}

	return sections.filter(s => s.items.length > 0);
};

const toRelease = (raw: unknown): Release | null => {
	const release = raw as {
		tag_name?: unknown;
		html_url?: unknown;
		published_at?: unknown;
		body?: unknown;
		draft?: unknown;
		prerelease?: unknown;
	};

	if (
		typeof release?.tag_name !== 'string' ||
		!STRICT_VERSION.test(release.tag_name) ||
		release.draft ||
		release.prerelease
	) {
		return null;
	}

	return {
		version: normalizeVersion(release.tag_name),
		url: typeof release.html_url === 'string' ? release.html_url : '',
		publishedAt:
			typeof release.published_at === 'string' &&
			!Number.isNaN(Date.parse(release.published_at))
				? release.published_at
				: null,
		sections:
			typeof release.body === 'string' ? parseReleaseNotes(release.body) : [],
	};
};

const toReleases = (raw: unknown): Release[] =>
	Array.isArray(raw)
		? raw.map(toRelease).filter((release): release is Release => !!release)
		: [];

// npm is published before its GitHub release leaves prerelease, so a list
// without `latest` is a gap that closes within the hour, not the day's answer.
const getReleases = async (latest: string): Promise<Release[]> =>
	toReleases(
		await cachedJson(RELEASES_URL, raw =>
			toReleases(raw).some(
				release => compareVersions(release.version, latest) === 0,
			),
		),
	);

/** The releases after `current` up to and including `latest`, newest first. */
export const releasesBetween = (
	releases: Release[],
	current: string,
	latest: string,
): Release[] =>
	releases
		.filter(
			release =>
				compareVersions(release.version, current) > 0 &&
				compareVersions(release.version, latest) <= 0,
		)
		.sort((a, b) => compareVersions(b.version, a.version));

export const UPDATE_COMMANDS = {
	script: `curl -fsSL ${INSTALL_SCRIPT_URL} | sh`,
	npm: 'npm install --global epiq@latest',
};

/** Release notes are only fetched once there is something newer to describe. */
export const getUpdateInfo = async (current: string): Promise<UpdateInfo> => {
	const status = await getVersionStatus(current);
	if (!status.updateAvailable || !status.latest) {
		return {
			...status,
			releases: [],
			currentPublishedAt: null,
			commands: UPDATE_COMMANDS,
		};
	}

	const all = await getReleases(status.latest);

	return {
		...status,
		releases: releasesBetween(all, current, status.latest),
		currentPublishedAt:
			all.find(release => compareVersions(release.version, current) === 0)
				?.publishedAt ?? null,
		commands: UPDATE_COMMANDS,
	};
};
