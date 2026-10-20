import {descriptionLimitOf} from '../../../lib/utils/text.limits.js';
import {AsideDock} from '../lib/aside-dock';
import {GuiBoard} from '../lib/gui-state.model';
import {useEditDraft} from '../lib/ticket-drafts';
import {Aside} from './Aside';
import {DescriptionField} from './DescriptionField';
import {DetailsHeader} from './NodeDetails';

export const BoardDetails = ({
	dock,
	board,
	onSaveDescription,
	onClose,
}: {
	dock: AsideDock;
	board: GuiBoard;
	onSaveDescription: (description: string) => void;
	onClose: () => void;
}) => {
	const descriptionEdit = useEditDraft(
		board.id,
		'description',
		board.description ?? '',
	);

	return (
		<Aside dock={dock}>
			<DetailsHeader
				testId="board-details"
				kind="Board"
				title={board.title}
				onClose={onClose}
			/>

			<DescriptionField
				draft={descriptionEdit}
				current={board.description ?? ''}
				readonly={board.readonly}
				maxLength={descriptionLimitOf('board')}
				onSave={onSaveDescription}
				collapseKey={board.id}
				testId="board-description"
				placeholder="Conventions for this board, in markdown"
			/>
		</Aside>
	);
};
