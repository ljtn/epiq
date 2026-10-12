// What may be registered as a repo's URL. Pure: the GUI client checks a URL
// as it is typed with the same rule the server refuses it by.

const SCHEMES = new Set(['https:', 'http:', 'ssh:', 'git:', 'file:']);
// `user@host:path`, the form ssh remotes are usually written in. Both names
// open on a letter or digit: one opening on `-` reaches ssh as an option.
const SCP_URL = /^[A-Za-z0-9][\w.-]*@[A-Za-z0-9][\w.-]*:[^:]+$/;
// Visible ASCII: no spaces, no control characters to rewrite a terminal with,
// no lookalike letters to pass one host off as another.
const PRINTABLE = /^[\x21-\x7e]+$/;
const MAX_URL_LENGTH = 2048;

/** The forms a URL may take, for the line that refuses one. */
export const REPO_URL_FORMS =
	'Use https://, ssh://, git://, file:/// or user@host:path.';

/**
 * Why a URL may not be registered, or null when it may. It arrives from a
 * committed file, so it is anybody's who can open a pull request: plain git
 * transports only, nothing git could read as a flag, nothing that runs a
 * command (`ext::` or any other `<helper>::` remote), a local path only as an
 * explicit `file:///`, and no password — one in a committed URL is a leaked
 * one, and a credential helper is where it belongs.
 */
export const repoUrlProblem = (url: string): string | null => {
	if (url.length > MAX_URL_LENGTH) return 'is too long';
	if (!PRINTABLE.test(url)) return 'holds spaces or characters git would not';
	if (url.startsWith('-')) return 'would be read as an option';
	// A backslash, a `#` or a `?` has no use in a clone URL, and each is read
	// one way by the URL parser here and another by git and curl: a `\` or a
	// `#@host` makes one host read as another while git connects elsewhere.
	if (/[\\#?]/.test(url)) return 'holds a character a clone URL has no use for';
	// `<transport>::<address>` hands the address to `git remote-<transport>`.
	// An IPv6 literal carries `::` inside its brackets, which is not that.
	if (url.replace(/\[[^\]]*\]/g, '').includes('::')) {
		return 'names a remote helper';
	}
	if (SCP_URL.test(url)) return null;

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return 'is not a remote URL';
	}

	// Git decodes the authority before it reads it, so `%2d` is `-` to git and
	// an option once decoded; the checks below see the encoded text. Nothing
	// in a host or a login needs encoding.
	if (/%/.test(authorityOf(url))) return 'percent-encodes its host';

	if (!SCHEMES.has(parsed.protocol)) {
		return 'uses a transport epiq does not clone over';
	}
	if (parsed.password) return 'carries a password — use a credential helper';
	// Over ssh the user is the login; anywhere else it is only a way to make
	// one host read as another (`https://github.com@evil.example/…`).
	if (parsed.username && parsed.protocol !== 'ssh:') {
		return 'names a user before the host — leave it to a credential helper';
	}

	if (parsed.protocol === 'file:') {
		// A file URL naming another machine is read by some platforms as a
		// network share.
		if (parsed.hostname) return 'names a host in a file:// URL';
		// `file:x` is not a file URL to git: it reads as ssh to a host `file`.
		return url.startsWith('file:///') ? null : 'is not a file:/// URL';
	}

	if (!parsed.hostname) return 'names no host';
	if (parsed.hostname.startsWith('-') || parsed.username.startsWith('-')) {
		return 'would be read as an option';
	}

	return null;
};

// What stands between the scheme's `//` and the path.
const authorityOf = (url: string): string => {
	const start = url.indexOf('//');
	if (start === -1) return '';
	const rest = url.slice(start + 2);
	const end = rest.indexOf('/');
	return end === -1 ? rest : rest.slice(0, end);
};

export const isAllowedRepoUrl = (url: string): boolean =>
	repoUrlProblem(url) === null;
