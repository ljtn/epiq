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
		// `share` is filled in below, once every language's total is known.
		const entry = byName.get(name) ?? {
			name,
			added: 0,
			removed: 0,
			addedInTests: 0,
			share: 0,
		};

		entry.added += file.addedCount;
		entry.removed += file.removed;
		if (isTestPath(file.path)) entry.addedInTests += file.addedCount;

		byName.set(name, entry);
	}

	const totalChanged = [...byName.values()].reduce(
		(total, entry) => total + entry.added + entry.removed,
		0,
	);

	const languages = [...byName.values()]
		// Share of the change rather than raw counts: which language this
		// ticket is *in* is the question, and the +/- is already on the tab
		// next door.
		.map(entry => ({
			...entry,
			share:
				totalChanged === 0 ? 0 : (entry.added + entry.removed) / totalChanged,
		}))
		.sort((a, b) => b.added + b.removed - (a.added + a.removed));

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
