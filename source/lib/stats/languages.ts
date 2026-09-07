// Which languages a ticket's change is written in, and which of them the
// repository had never seen before it.
//
// Counted in lines rather than files: a one-line YAML tweak beside a thousand
// lines of Go is not half a change in each.

import {isGeneratedPath, isTestPath, languageOf} from './file-kinds.js';
import {LanguageBreakdown, LanguageLines} from './issue-stats.model.js';
import {TicketPatch} from './patch-scan.js';

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

		const changed = file.addedCount + file.removed;

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

		entry.added += file.addedCount;
		entry.removed += file.removed;
		if (isTestPath(file.path)) entry.addedInTests += file.addedCount;

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
