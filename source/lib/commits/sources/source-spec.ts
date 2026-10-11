// A source of code history: the board's own repository, or a remote one the
// board watches.
//
// Sources are registered by URL in `.epiq/project.json` and identified on the
// board by a short slug — never a filesystem path — so every machine
// materializes the same list the same way. This module holds only the spec's
// shape; turning a spec into something git can be pointed at is `registry.ts`
// below it, and fetching clones is `clone-store.ts` (later phase).
import {z} from 'zod';

// The board's own repository, read in place rather than cloned. Always
// resolvable, including on a project file that lists no sources.
export const SELF_SOURCE_ID = 'self';

// A slug names a source in commit entries, filters and status, and reaches a
// filesystem path under `.epiq/sources/` — so it is held to what can never
// escape that directory (`..`, separators) and never needs shell quoting.
// "self" is excluded separately, as the reserved id above.
export const SOURCE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const sourceIdSchema = z
	.string()
	.regex(
		SOURCE_ID_PATTERN,
		'must be lowercase letters, digits and dashes, starting with a letter or digit',
	)
	.refine(id => id !== SELF_SOURCE_ID, {
		message: `"${SELF_SOURCE_ID}" names the board's own repository and cannot be registered`,
	});

// Any URL a plain `git clone` accepts. No forge schemas: one of Epiq's core
// ideas is being vendor agnostic, so a source is registered the same way
// whatever is on the other end.
export const sourceUrlSchema = z.string().url();

// Git ref names, which is what these are. Validated no further than "a
// non-empty string": git is the authority on ref syntax, and a branch that
// does not exist is a clone-store failure to report, not a config file to
// reject here.
export const sourceBranchSchema = z.string().min(1);

export const SourceSpecSchema = z.object({
	id: sourceIdSchema,
	url: sourceUrlSchema,
	// Which branches to include. Absent means the remote's default branch,
	// discovered once at registration and frozen into the spec when the
	// configuration surfaces exist (a later phase), so the board stays
	// deterministic across machines.
	branches: z.array(sourceBranchSchema).optional(),
	// How much history to keep, as the earliest commit time worth cloning.
	// Absent defaults to the board's own createdAt.
	since: z.iso.datetime().optional(),
});

export type SourceSpec = z.infer<typeof SourceSpecSchema>;
