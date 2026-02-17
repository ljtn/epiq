export function findOverlap(wordA: string, wordB: string) {
	let overlap = 0;
	for (let i = 0; i < wordA.length; i++) {
		overlap++;
		if (wordB[i] !== wordA[i]) {
			break;
		}
	}
	return overlap;
}
