// What a path is: which language, and which of the roles a repository gives
// its files — test, generated, dependency manifest, build plumbing, prose.
//
// One table rather than one per question, because the questions overlap: a
// `.ts` under `__tests__` is TypeScript *and* a test, and a `.json` named
// `package-lock.json` is generated JSON nobody wrote. Every classifier here is
// a convention, so each is wrong somewhere — which is why the stats they feed
// are framed as questions to ask rather than verdicts to trust.

export type CommentSyntax = {
	line: string[];
	// Open/close pairs. Python's docstring quotes sit here too: they are not
	// comments to the parser, but they are prose to a reader, and counting
	// them as code would call every documented module uncommented.
	block: [string, string][];
};

type LanguageSpec = {
	name: string;
	comment: CommentSyntax;
};

const C_LIKE: CommentSyntax = {line: ['//'], block: [['/*', '*/']]};
const HASH: CommentSyntax = {line: ['#'], block: []};
const DASH: CommentSyntax = {line: ['--'], block: []};
const MARKUP: CommentSyntax = {line: [], block: [['<!--', '-->']]};
const NONE: CommentSyntax = {line: [], block: []};

const language = (name: string, comment: CommentSyntax): LanguageSpec => ({
	name,
	comment,
});

const TYPESCRIPT = language('TypeScript', C_LIKE);
const JAVASCRIPT = language('JavaScript', C_LIKE);

// Keyed by lowercase extension. Deliberately finite: an extension nobody
// listed lands in "Other" and still counts towards the totals, which is
// better than guessing at its comment syntax and miscounting prose as code.
const BY_EXTENSION: Record<string, LanguageSpec> = {
	ts: TYPESCRIPT,
	tsx: TYPESCRIPT,
	mts: TYPESCRIPT,
	cts: TYPESCRIPT,
	js: JAVASCRIPT,
	jsx: JAVASCRIPT,
	mjs: JAVASCRIPT,
	cjs: JAVASCRIPT,
	py: language('Python', {line: ['#'], block: [['"""', '"""']]}),
	rb: language('Ruby', {line: ['#'], block: [['=begin', '=end']]}),
	go: language('Go', C_LIKE),
	rs: language('Rust', C_LIKE),
	java: language('Java', C_LIKE),
	kt: language('Kotlin', C_LIKE),
	swift: language('Swift', C_LIKE),
	c: language('C', C_LIKE),
	h: language('C', C_LIKE),
	cc: language('C++', C_LIKE),
	cpp: language('C++', C_LIKE),
	hpp: language('C++', C_LIKE),
	cs: language('C#', C_LIKE),
	php: language('PHP', C_LIKE),
	scala: language('Scala', C_LIKE),
	dart: language('Dart', C_LIKE),
	lua: language('Lua', DASH),
	hs: language('Haskell', DASH),
	sql: language('SQL', DASH),
	ex: language('Elixir', HASH),
	exs: language('Elixir', HASH),
	pl: language('Perl', HASH),
	r: language('R', HASH),
	jl: language('Julia', HASH),
	sh: language('Shell', HASH),
	bash: language('Shell', HASH),
	zsh: language('Shell', HASH),
	vue: language('Vue', MARKUP),
	svelte: language('Svelte', MARKUP),
	html: language('HTML', MARKUP),
	xml: language('XML', MARKUP),
	md: language('Markdown', MARKUP),
	mdx: language('Markdown', MARKUP),
	css: language('CSS', {line: [], block: [['/*', '*/']]}),
	scss: language('CSS', C_LIKE),
	less: language('CSS', C_LIKE),
	yml: language('YAML', HASH),
	yaml: language('YAML', HASH),
	toml: language('TOML', HASH),
	ini: language('INI', HASH),
	// No comment syntax at all, so nothing in a JSON file is ever prose.
	json: language('JSON', NONE),
};

export const OTHER_LANGUAGE = 'Other';

export const extensionOf = (path: string): string => {
	const name = path.slice(path.lastIndexOf('/') + 1);
	const dot = name.lastIndexOf('.');

	// A leading dot is the whole name of a dotfile, not an extension.
	return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
};

export const languageOf = (path: string): string =>
	BY_EXTENSION[extensionOf(path)]?.name ?? OTHER_LANGUAGE;

// Null for a language nobody listed: a caller that cannot tell a comment from
// code should count neither rather than assume `//`.
export const commentSyntaxOf = (path: string): CommentSyntax | null =>
	BY_EXTENSION[extensionOf(path)]?.comment ?? null;

const TEST_FILE = [
	/\.(test|spec)\.[a-z0-9]+$/i,
	/(^|\/)test_[^/]+\.py$/,
	/_test\.[a-z0-9]+$/i,
	/(^|\/)conftest\.py$/,
	/Tests?\.(java|kt|cs|scala)$/,
];

const TEST_DIRECTORY =
	/(^|\/)(tests?|__tests__|spec|specs|e2e|src\/test|features)\//i;

export const isTestPath = (path: string): boolean =>
	TEST_DIRECTORY.test(path) || TEST_FILE.some(pattern => pattern.test(path));

const LOCKFILE =
	/(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|poetry\.lock|Gemfile\.lock|composer\.lock)$/;

const GENERATED_DIRECTORY =
	/(^|\/)(node_modules|dist|build|out|target|vendor|coverage|\.next|__snapshots__)\//;

const GENERATED_FILE = /(\.min\.(js|css)|\.map|\.snap|\.pb\.go|_pb2\.py)$/;

/**
 * Written by a tool, not by the ticket. Counted in the totals — the change is
 * real and a reviewer should know a lockfile moved — but kept out of every
 * ratio, since a regenerated lockfile would otherwise drown the numbers that
 * describe what somebody actually wrote.
 */
export const isGeneratedPath = (path: string): boolean =>
	LOCKFILE.test(path) ||
	GENERATED_DIRECTORY.test(path) ||
	GENERATED_FILE.test(path);

export const isDependencyManifest = (path: string): boolean =>
	/(^|\/)(package\.json|go\.mod|Cargo\.toml|requirements[^/]*\.txt|pyproject\.toml|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?)$/.test(
		path,
	);

export const isBuildOrCiPath = (path: string): boolean =>
	/(^|\/)\.github\/workflows\//.test(path) ||
	/(^|\/)(Dockerfile|docker-compose[^/]*\.ya?ml|Makefile|Jenkinsfile|\.gitlab-ci\.yml)$/.test(
		path,
	) ||
	/\.tf$/.test(path);

export const isDocPath = (path: string): boolean =>
	/\.(md|mdx|rst|txt)$/i.test(path) || /(^|\/)docs?\//i.test(path);

// A test that was written and then switched off. `.only` is the sharper of
// the two: it does not announce itself in a run's output the way a skip does,
// it silently reduces the suite to one case, and it reaches main looking like
// a passing build.
const SKIPPED_TEST =
	/\b(it|test|describe|context|suite)\.skip\b|\bx(it|describe|test)\s*\(|@pytest\.mark\.skip|@unittest\.skip|\bt\.Skip\s*\(|@(Ignore|Disabled)\b/;

const FOCUSED_TEST =
	/\b(it|test|describe|context|suite)\.only\b|\bf(it|describe|test)\s*\(/;

export const isSkippedTestLine = (text: string): boolean =>
	SKIPPED_TEST.test(text);

export const isFocusedTestLine = (text: string): boolean =>
	FOCUSED_TEST.test(text);
