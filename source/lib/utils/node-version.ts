// Imports nothing: the entries check the runtime before loading code an older
// Node cannot run.

export const MIN_NODE_MAJOR = 22;

/** Why this Node cannot run epiq, or null when it can. */
export const nodeVersionProblem = (version: string): string | null => {
	const major = Number(version.split('.')[0]);
	if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) return null;

	return [
		`epiq needs Node ${MIN_NODE_MAJOR} or newer; this is Node ${version}.`,
		'Install a newer Node, or use the release binary, which carries its own.',
	].join('\n');
};

/** Exits with the reason when this Node is too old. */
export const exitOnOldNode = (): void => {
	const problem = nodeVersionProblem(process.versions.node);
	if (problem === null) return;

	process.stderr.write(`${problem}\n`);
	process.exit(1);
};
