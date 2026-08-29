import React, {createContext, useContext} from 'react';
import ReactMarkdown, {type Components} from 'react-markdown';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import {CONTENT_FONT, GUI_THEME} from '../lib/gui-theme';

// react-markdown wraps a fenced block in <pre><code>, and only sets a
// className on the <code> when the fence names a language — so keying
// block-vs-inline off className alone renders a bare ``` fence as inline,
// wrapping it into one ragged background box per line. Being inside a <pre>
// is the thing that actually distinguishes the two.
const InPre = createContext(false);

const CODE_FONT =
	'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

const components: Components = {
	p: ({children}) => <p style={{margin: '0 0 14px'}}>{children}</p>,
	ul: ({children}) => (
		<ul style={{margin: '0 0 14px', paddingLeft: 20}}>{children}</ul>
	),
	ol: ({children}) => (
		<ol style={{margin: '0 0 14px', paddingLeft: 20}}>{children}</ol>
	),
	li: ({children}) => <li style={{margin: '2px 0'}}>{children}</li>,
	h1: ({children}) => (
		<h1 style={{fontSize: 16, margin: '0 0 14px'}}>{children}</h1>
	),
	h2: ({children}) => (
		<h2 style={{fontSize: 14, margin: '0 0 14px'}}>{children}</h2>
	),
	h3: ({children}) => (
		<h3 style={{fontSize: 13, margin: '0 0 14px'}}>{children}</h3>
	),
	a: ({children, href}) => (
		<a
			href={href}
			target="_blank"
			rel="noreferrer"
			style={{color: GUI_THEME.accent}}
		>
			{children}
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

		// A block's own chrome (background, padding, scrolling) belongs to the
		// <pre> below, so that one contiguous box wraps every line rather than
		// each line carrying its own.
		return (
			<code
				style={
					isBlock
						? {fontFamily: CODE_FONT, fontSize: 12}
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
};

export const MarkdownContent = ({
	content,
	softBreaks = false,
}: {
	content: string;
	// Treats single newlines as line breaks (like a chat message) instead of
	// requiring a blank line for a new paragraph, per strict CommonMark.
	softBreaks?: boolean;
}) => (
	<div
		style={{
			fontFamily: CONTENT_FONT,
			fontSize: 13,
			lineHeight: 1.6,
			color: GUI_THEME.primary,
			wordBreak: 'break-word',
			// Cancels the last block child's trailing bottom margin via
			// collapsing, so the container doesn't end in dead whitespace.
			marginBottom: -14,
		}}
	>
		<ReactMarkdown
			remarkPlugins={softBreaks ? [remarkGfm, remarkBreaks] : [remarkGfm]}
			components={components}
		>
			{content}
		</ReactMarkdown>
	</div>
);
