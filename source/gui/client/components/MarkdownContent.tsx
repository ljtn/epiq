import React, {
	createContext,
	useContext,
	useMemo,
	useRef,
	useState,
} from 'react';
import ReactMarkdown, {
	type Components,
	defaultUrlTransform,
} from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import {GUI_THEME, PROSE, TEXT} from '../lib/gui-theme';
import {
	remarkTicketRefs,
	TICKET_REF_URL_PREFIX,
} from '../lib/remark-ticket-refs';
import {TICKET_REF_ATTRIBUTE} from './TicketPreviewLayer';

// Block vs inline code is told by being inside a <pre>: a bare ``` fence's
// <code> has no className.
const InPre = createContext(false);

// Provided by whoever knows the board, so prose deep in the tree can resolve refs.
export type TicketRefLinks = {
	// Only refs that resolve become links; the shape alone matches ordinary words.
	isKnownRef: (ref: string) => boolean;
	onOpen: (ref: string) => void;
};

const TicketRefLinksContext = createContext<TicketRefLinks | null>(null);

export const TicketRefLinksProvider = TicketRefLinksContext.Provider;

// Lets the app's own ref marker past react-markdown's sanitizer, which would
// strip its protocol; everything else is sanitized as usual.
const urlTransform = (url: string): string =>
	url.startsWith(TICKET_REF_URL_PREFIX) ? url : defaultUrlTransform(url);

const CODE_FONT =
	'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// A ticket ref in prose. Hover washes it in its colour, padded and pulled back
// so the line doesn't move.
const TicketRefLink = ({
	refValue,
	onOpen,
	children,
}: {
	refValue: string;
	onOpen?: (ref: string) => void;
	children: React.ReactNode;
}) => {
	const [hovered, setHovered] = useState(false);

	return (
		<button
			type="button"
			// No `title`: this attribute summons TicketPreviewLayer's card instead.
			{...{[TICKET_REF_ATTRIBUTE]: refValue}}
			aria-label={`Open ${refValue}`}
			onClick={() => onOpen?.(refValue)}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			style={{
				padding: '2px 3px',
				margin: '-2px -3px',
				background: hovered ? `${GUI_THEME.accent}2b` : 'transparent',
				border: 'none',
				borderRadius: 3,
				cursor: 'pointer',
				font: 'inherit',
				color: GUI_THEME.accent,
				textDecoration: 'underline',
				textUnderlineOffset: 2,
				transition: 'background 120ms ease',
			}}
		>
			{children}
		</button>
	);
};

// Built per-instance rather than at module scope: the anchor renderer has to
// close over the ref-click handler.
const buildComponents = (
	onOpenTicketRef?: (ref: string) => void,
): Components => ({
	p: ({children}) => <p style={{margin: '0 0 14px'}}>{children}</p>,
	ul: ({children}) => (
		<ul style={{margin: '0 0 14px', paddingLeft: 20}}>{children}</ul>
	),
	ol: ({children}) => (
		<ol style={{margin: '0 0 14px', paddingLeft: 20}}>{children}</ol>
	),
	li: ({children}) => <li style={{margin: '2px 0'}}>{children}</li>,
	h1: ({children}) => (
		<h1 style={{fontSize: TEXT.prose + 2, margin: '0 0 14px'}}>{children}</h1>
	),
	h2: ({children}) => (
		<h2 style={{fontSize: TEXT.prose + 1, margin: '0 0 14px'}}>{children}</h2>
	),
	h3: ({children}) => (
		<h3 style={{fontSize: TEXT.prose, margin: '0 0 14px'}}>{children}</h3>
	),
	a: ({children, href}) => {
		// A ticket ref opens in-app, so it is a control, not an anchor.
		if (href?.startsWith(TICKET_REF_URL_PREFIX)) {
			return (
				<TicketRefLink
					refValue={href.slice(TICKET_REF_URL_PREFIX.length)}
					onOpen={onOpenTicketRef}
				>
					{children}
				</TicketRefLink>
			);
		}

		return (
			<a
				href={href}
				target="_blank"
				rel="noreferrer"
				style={{color: GUI_THEME.accent}}
			>
				{children}
			</a>
		);
	},
	// Bounded to its column, and links to the blob for full size.
	img: ({src, alt}) => (
		<a
			href={typeof src === 'string' ? src : undefined}
			target="_blank"
			rel="noreferrer"
			style={{display: 'block'}}
		>
			<img
				src={typeof src === 'string' ? src : undefined}
				alt={alt ?? ''}
				loading="lazy"
				style={{
					display: 'block',
					maxWidth: '100%',
					borderRadius: 6,
					border: `1px solid ${GUI_THEME.line}`,
					cursor: 'zoom-in',
				}}
			/>
		</a>
	),
	blockquote: ({children}) => (
		<blockquote
			style={{
				margin: '0 0 14px',
				paddingLeft: 12,
				borderLeft: `2px solid ${GUI_THEME.line}`,
				color: GUI_THEME.secondary,
			}}
		>
			{children}
		</blockquote>
	),
	code: ({children}) => {
		const isBlock = useContext(InPre);

		// The <pre> carries the block's chrome, so one box wraps every line.
		return (
			<code
				style={
					isBlock
						? {fontFamily: CODE_FONT, fontSize: TEXT.ui}
						: {
								fontFamily: CODE_FONT,
								fontSize: '0.9em',
								background: GUI_THEME.bg,
								borderRadius: 4,
								padding: '1px 5px',
						  }
				}
			>
				{children}
			</code>
		);
	},
	pre: ({children}) => (
		<InPre.Provider value={true}>
			<pre
				style={{
					margin: '0 0 14px',
					padding: '10px 12px',
					background: GUI_THEME.bg,
					borderRadius: 6,
					overflowX: 'auto',
					whiteSpace: 'pre',
				}}
			>
				{children}
			</pre>
		</InPre.Provider>
	),
	hr: () => (
		<hr
			style={{
				border: 'none',
				borderTop: `1px solid ${GUI_THEME.line}`,
				margin: '12px 0',
			}}
		/>
	),
});

// A single newline is a line break, as it was typed, rather than CommonMark's
// space; a blank line still starts a paragraph.
export const MarkdownContent = ({content}: {content: string}) => {
	const ticketRefLinks = useContext(TicketRefLinksContext);

	// Built once: new renderers are new component types and would remount. The
	// handler is read at click time.
	const onOpen = useRef(ticketRefLinks?.onOpen);
	onOpen.current = ticketRefLinks?.onOpen;
	const components = useMemo(
		() => buildComponents(ref => onOpen.current?.(ref)),
		[],
	);

	const remarkPlugins = useMemo(
		() => [
			remarkGfm,
			remarkBreaks,
			...(ticketRefLinks ? [remarkTicketRefs(ticketRefLinks.isKnownRef)] : []),
		],
		[ticketRefLinks],
	);

	return (
		<div
			style={{
				...PROSE,
				color: GUI_THEME.primary,
				wordBreak: 'break-word',
				// Cancels the last block child's trailing bottom margin via
				// collapsing, so the container doesn't end in dead whitespace.
				marginBottom: -14,
			}}
		>
			<ReactMarkdown
				remarkPlugins={remarkPlugins}
				components={components}
				urlTransform={urlTransform}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
};
