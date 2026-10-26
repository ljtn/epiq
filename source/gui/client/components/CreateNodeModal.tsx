import {MAX_TITLE_LENGTH} from '../../../lib/utils/text.limits.js';
import {Button} from './Button';
import {Input} from './FormPrimitives';
import {Modal, ModalHeading} from './Modal';

// Shared by the issue, swimlane and board modals, creating and renaming;
// only the wording differs.
type Props = {
	eyebrow: string;
	// What the field is about, where the eyebrow and placeholder do not say.
	fieldLabel?: string;
	placeholder: string;
	confirmLabel?: string;
	title: string;
	onChangeTitle: (title: string) => void;
	onCreate: () => void;
	onClose: () => void;
};

export const CreateNodeModal = ({
	eyebrow,
	fieldLabel,
	placeholder,
	confirmLabel = 'Create',
	title,
	onChangeTitle,
	onCreate,
	onClose,
}: Props) => (
	<Modal
		eyebrow={eyebrow}
		width={360}
		onClose={onClose}
		onSubmit={onCreate}
		actions={
			<>
				{/* Not a submit button: as Enter would activate it instead of the
				    form's onSubmit. */}
				<Button type="button" variant="ghost" onClick={onClose}>
					Cancel
				</Button>

				<Button type="submit" variant="primary">
					{confirmLabel}
				</Button>
			</>
		}
	>
		{fieldLabel && <ModalHeading>{fieldLabel}</ModalHeading>}

		<Input
			autoFocus
			value={title}
			// The server's own cap, so an overlong title is stopped here rather
			// than shown on the board and then taken back by the refusal.
			maxLength={MAX_TITLE_LENGTH}
			placeholder={placeholder}
			onChange={event => onChangeTitle(event.target.value)}
		/>
	</Modal>
);
