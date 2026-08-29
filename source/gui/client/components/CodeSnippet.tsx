import {useState} from 'react';
import {File} from '@pierre/diffs/react';
import {GUI_THEME} from '../lib/gui-theme';
import {CopyShaButton} from './CopyShaButton';
import {IconChevronDown} from './IconChevronDown';
import {IconChevronRight} from './IconChevronRight';

// The same highlighter and theme the diff view itself renders with, so a
// snippet quoted into a comment looks like the code it was taken from rather
// than like markdown text. `name` is what infers the language, which is why
// the quoting side keeps the real file path around.
const PIERRE_THEME = 'github-dark';

const CODE_FONT =
	'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

// Pinned on the highlighter through its own CSS variables so the gutter drawn
// beside it lands on the same line grid.
const LINE_HEIGHT = 20;
const FONT_SIZE = 12;
const BLOCK_GAP = 8;

const bareButton: React.CSSProperties = {
	background: 'transparent',
	border: 'none',
	padding: 0,
	cursor: 'pointer',
	font: 'inherit',
	color: 'inherit',
};

export const CodeSnippet = ({
	filePath,
	snippet,
	caption,
	onOpen,
	sha,
	startLine,
}: {
	filePath: string;
	snippet: string;
	// With a caption the snippet gets a header: the caption as its title
	// (a link when onOpen is given), a collapse toggle, and a copy button for
	// the commit it came from.
	caption?: string;
	onOpen?: () => void;
	sha?: string;
	// Number the lines from here, as they were numbered where the snippet was
	// taken from. The highlighter can only count from 1, so the gutter is
	// drawn here beside it, on the same line grid.
	startLine?: number;
}) => {
	const [collapsed, setCollapsed] = useState(false);
	const lineCount = snippet.split('\n').length;

	return (
		<div
			data-testid="code-snippet"
			style={{
				marginTop: 8,
				border: `1px solid ${GUI_THEME.line}`,
				borderRadius: 8,
				overflow: 'hidden',
			}}
		>
			{caption !== undefined && (
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 6,
						padding: '4px 6px 4px 4px',
						background: 'rgba(255,255,255,0.03)',
						borderBottom: collapsed ? 'none' : `1px solid ${GUI_THEME.line}`,
						fontFamily: CODE_FONT,
						fontSize: 11,
						color: GUI_THEME.secondary,
					}}
				>
					<button
						type="button"
						aria-expanded={!collapsed}
						title={collapsed ? 'Show snippet' : 'Hide snippet'}
						onClick={() => setCollapsed(value => !value)}
						style={{
							...bareButton,
							display: 'inline-flex',
							alignItems: 'center',
							padding: 4,
							color: GUI_THEME.dim,
						}}
					>
						{collapsed ? (
							<IconChevronRight size={12} />
						) : (
							<IconChevronDown size={12} />
						)}
					</button>

					{onOpen ? (
						<button
							type="button"
							onClick={onOpen}
							title="Open this in the diff"
							style={{
								...bareButton,
								flex: 1,
								minWidth: 0,
								textAlign: 'left',
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap',
								color: GUI_THEME.accent,
								textDecoration: 'underline',
								textUnderlineOffset: 2,
							}}
						>
							{caption}
						</button>
					) : (
						<span
							style={{
								flex: 1,
								minWidth: 0,
								overflow: 'hidden',
								textOverflow: 'ellipsis',
								whiteSpace: 'nowrap',
							}}
						>
							{caption}
						</span>
					)}

					{sha && <CopyShaButton sha={sha} />}
				</div>
			)}

			{!collapsed && (
				<div
					style={
						{
							display: 'flex',
							'--diffs-line-height': `${LINE_HEIGHT}px`,
							'--diffs-font-size': `${FONT_SIZE}px`,
							'--diffs-gap-block': `${BLOCK_GAP}px`,
						} as React.CSSProperties
					}
				>
					{startLine !== undefined && (
						<div
							data-testid="snippet-gutter"
							aria-hidden
							style={{
								flexShrink: 0,
								padding: `${BLOCK_GAP}px 8px 0 12px`,
								textAlign: 'right',
								fontFamily: CODE_FONT,
								fontSize: FONT_SIZE,
								lineHeight: `${LINE_HEIGHT}px`,
								color: GUI_THEME.dim,
								userSelect: 'none',
							}}
						>
							{Array.from({length: lineCount}, (_, index) => (
								<div key={index}>{startLine + index}</div>
							))}
						</div>
					)}
					<div style={{flex: 1, minWidth: 0}}>
						<File
							file={{name: filePath, contents: snippet}}
							options={{
								theme: PIERRE_THEME,
								// The header already names the file, and the highlighter's
								// own numbers would start at 1 rather than at the lines the
								// snippet was taken from — the gutter beside it has those.
								disableFileHeader: true,
								disableLineNumbers: true,
							}}
						/>
					</div>
				</div>
			)}
		</div>
	);
};
