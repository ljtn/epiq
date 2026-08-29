import {useEffect, useRef, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';
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
// only to be reachable from it. The full sha lives in the tooltip.
export const CopyShaButton = ({sha}: {sha: string}) => {
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	useEffect(() => () => clearTimeout(resetTimer.current), []);

	return (
		<button
			type="button"
			title={copied ? 'Copied!' : `Copy ${sha}`}
			onClick={async event => {
				event.stopPropagation();

				if (await copyToClipboard(sha)) {
					setCopied(true);
					clearTimeout(resetTimer.current);
					resetTimer.current = setTimeout(() => setCopied(false), 1_200);
				}
			}}
			style={{
				display: 'inline-flex',
				alignItems: 'center',
				background: 'transparent',
				border: 'none',
				padding: 4,
				borderRadius: 4,
				cursor: 'pointer',
				color: copied ? GUI_THEME.green : GUI_THEME.dim,
				transition: 'color 120ms ease, background 120ms ease',
			}}
			onMouseEnter={event => {
				event.currentTarget.style.background = 'rgba(255,255,255,0.04)';
				if (!copied) event.currentTarget.style.color = GUI_THEME.accent;
			}}
			onMouseLeave={event => {
				event.currentTarget.style.background = 'transparent';
				event.currentTarget.style.color = copied
					? GUI_THEME.green
					: GUI_THEME.dim;
			}}
		>
			{copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
		</button>
	);
};
