import {useRepoLabel} from '../lib/use-repo-label';
import {Chip} from './Chip';

// Which registered repo a commit is from. Only ever drawn for another repo's
// commit: the board's own carry no repo, and a board with no other repos looks
// exactly as it did before there were any.
export const RepoChip = ({repo}: {repo: string}) => {
	const labelOf = useRepoLabel();

	return (
		// Narrow enough that the subject beside it keeps most of the row: the
		// subject is what the row is read for, the repo only says where.
		<Chip testId="commit-repo" style={{maxWidth: 96}}>
			{labelOf(repo)}
		</Chip>
	);
};
