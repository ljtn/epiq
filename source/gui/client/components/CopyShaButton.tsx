import {CopyButton} from './CopyButton';

// Icon-only, unlike CopyRef: the sha is not meant to sit in the row as text,
// only to be reachable from it.
export const CopyShaButton = ({sha}: {sha: string}) => (
	<CopyButton value={sha} testId="copy-sha" />
);
