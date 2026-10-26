import {Button} from './Button';
import {Modal, ModalHeading, ModalText} from './Modal';

type Props = {
	eyebrow: string;
	heading: string;
	body: string;
	confirmLabel: string;
	onConfirm: () => void;
	onClose: () => void;
};

export const ConfirmModal = ({
	eyebrow,
	heading,
	body,
	confirmLabel,
	onConfirm,
	onClose,
}: Props) => (
	<Modal
		testId="confirm-modal"
		eyebrow={eyebrow}
		danger
		width={360}
		onClose={onClose}
		onSubmit={onConfirm}
		actions={
			<>
				{/* Focused rather than the confirm button: a stray Enter on a
				    destructive dialog should back out, not go through with it. */}
				<Button autoFocus type="button" variant="ghost" onClick={onClose}>
					Cancel
				</Button>

				<Button type="submit" variant="primary" danger>
					{confirmLabel}
				</Button>
			</>
		}
	>
		<ModalHeading>{heading}</ModalHeading>
		<ModalText>{body}</ModalText>
	</Modal>
);
