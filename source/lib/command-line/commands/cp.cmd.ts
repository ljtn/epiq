import {CommandLineInput} from '../../model/action-map.model.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {getState} from '../../state/state.js';
import {copyTextToClipboard} from '../../utils/clipboard.js';
import {nodeRef} from '../../utils/node-ref.js';
import {CopyModifiers, ticketInScope} from '../command-modifiers.js';

const copyValue = async (
	value: string,
	label: string,
): Promise<Result<null>> => {
	if (!value.trim()) return failed(`Nothing to copy: ${label} is empty`);

	const copyResult = await copyTextToClipboard(value);
	if (isFail(copyResult)) return copyResult;

	return succeeded(`Copied ${label} to clipboard`, null);
};

export const copyCommand = async (
	cmdState: CommandLineInput,
): Promise<Result<null>> => {
	const {breadCrumb, selectedNode} = getState();
	const ticket = ticketInScope({breadCrumb, selectedNode});
	const target = ticket ?? selectedNode;

	if (!target) return failed('Nothing selected to copy from');

	switch (cmdState.modifier) {
		case CopyModifiers.REF:
			return copyValue(nodeRef(target.id), 'ref');

		case CopyModifiers.TITLE:
			return copyValue(target.title, 'title');

		case CopyModifiers.DESCRIPTION: {
			if (!ticket) return failed('No issue in scope');
			return copyValue(ticket.props?.description ?? '', 'description');
		}

		default:
			return failed('Copy one of: ref, title, description');
	}
};
