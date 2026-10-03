// A registered repo's id is its label and a hash of its URL, so the label is
// read back off the id without a list to look it up in. Mirrors
// `repoLabelOfId` in lib/commits/commit-repos.ts rather than importing it:
// that module is Node-side, and the GUI build refuses a client import of it.
export const repoLabelOf = (repoId: string): string =>
	repoId.replace(/-[0-9a-f]{8}$/, '');

/** A path qualified by its repo, for keys that must not collide across repos. */
export const repoPathKey = (path: string, repo?: string): string =>
	repo ? `${repo}:${path}` : path;
