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
}: {
	filePath: string;
	snippet: string;
	// With a caption the snippet gets a header: the caption as its title
	// (a link when onOpen is given), a collapse toggle, and a copy button for
	// the commit it came from.
	caption?: string;
	onOpen?: () => void;
	sha?: string;
}) => {
	const [collapsed, setCollapsed] = useState(false);

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
				<File
					file={{name: filePath, contents: snippet}}
					options={{
						theme: PIERRE_THEME,
						// The header already names the file and its line range, and the
						// snippet's own numbers would start at 1 rather than at the lines
						// it was taken from — actively misleading.
						disableFileHeader: true,
						disableLineNumbers: true,
					}}
				/>
			)}
		</div>
	);
};
