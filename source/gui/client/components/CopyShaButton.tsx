import {useEffect, useRef, useState} from 'react';
import {IconButton, ICON_SIZE} from './IconButton';
import {IconCheck} from './IconCheck';
import {IconCopy} from './IconCopy';

// The clipboard API needs a secure context, which localhost is; copying
// silently does nothing on e.g. plain-http LAN hosts.
const copyToClipboard = async (value: string): Promise<boolean> => {
	try {
		await navigator.clipboard.writeText(value);
		return true;
	} catch {
		return false;
	}
};

// Icon-only, unlike CopyRef: the sha is not meant to sit in the row as text,
// only to be reachable from it. The full sha lives in the tooltip, and the
// button stays lit for a moment with a tick once it has copied.
export const CopyShaButton = ({sha}: {sha: string}) => {
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	useEffect(() => () => clearTimeout(resetTimer.current), []);

	return (
		<IconButton
			testId="copy-sha"
			title={copied ? 'Copied!' : `Copy ${sha}`}
			pressed={copied}
			onClick={async event => {
				event.stopPropagation();

				if (await copyToClipboard(sha)) {
					setCopied(true);
					clearTimeout(resetTimer.current);
					resetTimer.current = setTimeout(() => setCopied(false), 1_200);
				}
			}}
		>
			{copied ? <IconCheck size={ICON_SIZE} /> : <IconCopy size={ICON_SIZE} />}
		</IconButton>
	);
};
