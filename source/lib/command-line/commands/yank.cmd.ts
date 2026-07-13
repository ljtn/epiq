import {CommandLineInput} from '../../model/action-map.model.js';
import {failed, isFail, Result, succeeded} from '../../model/result-types.js';
import {getState} from '../../state/state.js';
import {copyTextToClipboard} from '../../utils/clipboard.js';
import {nodeRef} from '../../utils/node-ref.js';
import {getTicketAssignees, getTicketTags} from '../../utils/ticket.utils.js';
import {YankModifiers, ticketInScope} from '../command-modifiers.js';

const copyValue = async (
	value: string,
	label: string,
): Promise<Result<null>> => {
	if (!value.trim()) return failed(`Nothing to copy: ${label} is empty`);

	const copyResult = await copyTextToClipboard(value);
	if (isFail(copyResult)) return copyResult;

	return succeeded(`Copied ${label} to clipboard`, null);
};

export const yankCommand = async (
	cmdState: CommandLineInput,
): Promise<Result<null>> => {
	const {breadCrumb, selectedNode} = getState();
	const ticket = ticketInScope({breadCrumb, selectedNode});
	const target = ticket ?? selectedNode;

	if (!target) return failed('Nothing selected to copy from');

	switch (cmdState.modifier) {
		case YankModifiers.REF:
			return copyValue(nodeRef(target.id), 'ref');

		case YankModifiers.TITLE:
			return copyValue(target.title, 'title');

		case YankModifiers.DESCRIPTION: {
			if (!ticket) return failed('No issue in scope');
			return copyValue(ticket.props?.description ?? '', 'description');
		}

		case YankModifiers.TAGS: {
			if (!ticket) return failed('No issue in scope');
			const tags = getTicketTags(ticket).map(({name}) => name);
			return copyValue(tags.join(', '), 'tags');
		}

		case YankModifiers.ASSIGNEES: {
			if (!ticket) return failed('No issue in scope');
			const assignees = getTicketAssignees(ticket).map(({name}) => name);
			return copyValue(assignees.join(', '), 'assignees');
		}

		default:
			return failed('Yank one of: ref, title, description, tags, assignees');
	}
};
