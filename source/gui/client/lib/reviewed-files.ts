import {useState} from 'react';

/** Which file diffs this browser has ticked as reviewed, keyed by commit and path. */
const STORAGE_KEY = 'epiq.commits.reviewedFiles';

const reviewedKey = (sha: string, path: string): string => `${sha}:${path}`;

// Anything but a list of strings — a hand edit, an older shape — reads as
// nothing reviewed rather than a broken tab.
export const readReviewedFiles = (): Set<string> => {
	try {
		const parsed: unknown = JSON.parse(
			localStorage.getItem(STORAGE_KEY) ?? '[]',
		);

		return new Set(
			Array.isArray(parsed)
				? parsed.filter((entry): entry is string => typeof entry === 'string')
				: [],
		);
	} catch {
		return new Set();
	}
};

export type ReviewedFiles = {
	isReviewed: (sha: string, path: string) => boolean;
	setReviewed: (sha: string, path: string, next: boolean) => void;
};

// Read in the initializer rather than an effect: a reviewed file should
// arrive shut, not fold a frame after it was painted open.
export const useReviewedFiles = (): ReviewedFiles => {
	const [reviewed, setReviewedFiles] = useState(readReviewedFiles);

	return {
		isReviewed: (sha, path) => reviewed.has(reviewedKey(sha, path)),
		setReviewed: (sha, path, next) => {
			setReviewedFiles(prev => {
				const updated = new Set(prev);
				if (next) {
					updated.add(reviewedKey(sha, path));
				} else {
					updated.delete(reviewedKey(sha, path));
				}
				localStorage.setItem(STORAGE_KEY, JSON.stringify([...updated]));

				return updated;
			});
		},
	};
};
