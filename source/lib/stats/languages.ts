// Which languages a ticket's change is written in, and which of them the
// repository had never seen before it.
//
// Counted in lines rather than files: a one-line YAML tweak beside a thousand
// lines of Go is not half a change in each.

import {isGeneratedPath, isTestPath, languageOf} from './file-kinds.js';
import {TicketPatch} from './patch-scan.js';

export type LanguageLines = {
	name: string;
	added: number;
	removed: number;
	// Of `added`, how much landed in test files. A language present only in
	// tests is a different fact from one the ticket wrote features in.
	addedInTests: number;
};

export type LanguageBreakdown = {
	languages: LanguageLines[];
	// Languages that appear in this change and in no file the repository had
	// at the commit before the ticket started. Empty when the baseline could
	// not be read (a root commit has no "before").
	introduced: string[];
	generatedLines: number;
};

export const deriveLanguages = ({
	patch,
	languagesBefore,
}: {
	patch: TicketPatch;
	// Every language present in the repo just before the ticket's first
	// commit; null when there was no earlier revision to read.
	languagesBefore: Set<string> | null;
}): LanguageBreakdown => {
	const byName = new Map<string, LanguageLines>();
	let generatedLines = 0;

	for (const file of patch.files) {
		if (file.binary) continue;

		const changed = file.added.length + file.removed;

		if (isGeneratedPath(file.path)) {
			generatedLines += changed;
			continue;
		}

		const name = languageOf(file.path);
		const entry = byName.get(name) ?? {
			name,
			added: 0,
			removed: 0,
			addedInTests: 0,
		};

		entry.added += file.added.length;
		entry.removed += file.removed;
		if (isTestPath(file.path)) entry.addedInTests += file.added.length;

		byName.set(name, entry);
	}

	const languages = [...byName.values()].sort(
		(a, b) => b.added + b.removed - (a.added + a.removed),
	);

	return {
		languages,
		introduced:
			languagesBefore === null
				? []
				: languages
						.filter(entry => !languagesBefore.has(entry.name))
						.map(entry => entry.name),
		generatedLines,
	};
};
