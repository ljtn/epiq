import {CODE_FONT} from '../lib/code-text.style';
import {GUI_THEME, TEXT} from '../lib/gui-theme';
import {useRepoLabel} from '../lib/use-repo-label';

// Which registered repo a commit is from. Only ever drawn for another repo's
// commit: the board's own carry no repo, and a board with no other repos looks
// exactly as it did before there were any.
export const RepoChip = ({repo}: {repo: string}) => {
	const labelOf = useRepoLabel();

	return (
		<span
			data-testid="commit-repo"
			style={{
				flexShrink: 0,
				// Narrow enough that the subject beside it keeps most of the row: the
				// subject is what the row is read for, the repo only says where.
				maxWidth: 96,
				overflow: 'hidden',
				textOverflow: 'ellipsis',
				whiteSpace: 'nowrap',
				padding: '1px 6px',
				border: `1px solid ${GUI_THEME.line}`,
				borderRadius: 4,
				color: GUI_THEME.dim2,
				fontFamily: CODE_FONT,
				fontSize: TEXT.label,
			}}
		>
			{labelOf(repo)}
		</span>
	);
};
