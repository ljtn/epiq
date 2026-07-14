import {useEffect, useRef, useState} from 'react';
import {GUI_THEME} from '../lib/gui-theme';

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

export const CopyRef = ({refValue}: {refValue: string}) => {
	const [copied, setCopied] = useState(false);
	const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	useEffect(() => () => clearTimeout(resetTimer.current), []);

	return (
		<button
			type="button"
			title={`Copy ${refValue}`}
			onClick={async event => {
				event.stopPropagation();

				if (await copyToClipboard(refValue)) {
					setCopied(true);
					clearTimeout(resetTimer.current);
					resetTimer.current = setTimeout(() => setCopied(false), 1_200);
				}
			}}
			style={{
				fontFamily: 'monospace',
				fontSize: 'inherit',
				color: copied ? GUI_THEME.green : GUI_THEME.dim,
				background: 'transparent',
				border: 'none',
				padding: 0,
				cursor: 'pointer',
				transition: 'color 120ms ease',
			}}
			onMouseEnter={event => {
				if (!copied) event.currentTarget.style.color = GUI_THEME.accent;
			}}
			onMouseLeave={event => {
				event.currentTarget.style.color = copied
					? GUI_THEME.green
					: GUI_THEME.dim;
			}}
		>
			{copied ? 'copied!' : refValue}
		</button>
	);
};
