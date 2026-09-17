import {ulid} from 'ulid';
import {materializeAndPersistAll} from '../../board/board-log.js';
import {resolveActorId} from '../../board/board-log.js';
import {isTicketNode} from '../../model/context.model.js';
import {failed, isFail} from '../../model/result-types.js';
import {findAncestor} from '../../repository/node-repo.js';
import {getCmdState} from '../../state/cmd.state.js';
import {getRenderedChildren, getState} from '../../state/state.js';
import {getAssignableContributors} from './assignable-contributors.js';
import {getPersistRoot} from '../../storage/paths.js';
import {actorOf} from '../../event/event.model.js';

export const assignUserCommand = async () => {
	const userRes = resolveActorId();
	if (isFail(userRes)) return failed('Unable to resolve user ID');

	const {modifier, inputString} = getCmdState().commandMeta;
	const raw = (modifier || inputString).trim();
	if (!raw) return failed('Provide an assignee');

	// "!" is the explicit gesture for inventing somebody new; without it an
	// unmatched name is refused rather than created from a typo.
	const wantsExternal = raw.startsWith('!');
	const name = (wantsExternal ? raw.slice(1) : raw).trim();
	if (!name) return failed('Provide an assignee');

	const {selectedIndex, contextNode} = getState();
	const selected = getRenderedChildren(contextNode.id)[selectedIndex];
	if (!selected) return failed('Invalid assign target');

	const ticketResult = findAncestor(selected.id, 'TICKET');
	if (isFail(ticketResult)) {
		return failed('Unable to assign issue in this context');
	}

	const ticket = ticketResult.value;
	if (!isTicketNode(ticket)) return failed('Target node is not issue');

	const persistRootResult = await getPersistRoot();
	if (isFail(persistRootResult)) return persistRootResult;

	const candidates = getAssignableContributors(persistRootResult.value);
	const isSelf = !wantsExternal && name.toLowerCase() === 'me';

	let contributorId: string;
	let contributorName: string;

	if (isSelf) {
		// The id your events are authored under, so both refer to one person.
		contributorId = userRes.value.userId;
		contributorName =
			candidates.find(c => c.id === contributorId)?.name ??
			userRes.value.userName;
	} else {
		const matches = candidates.filter(c => c.name === name);

		if (matches.length > 1) {
			return failed(
				`"${name}" matches ${matches.length} contributors (${matches
					.map(c => c.id)
					.join(', ')}). Assign from the GUI to choose by id.`,
			);
		}

		const match = matches[0];

		if (!match && !wantsExternal) {
			return failed(
				`No contributor named "${name}". Use "!${name}" to add them as an external assignee.`,
			);
		}

		contributorId = match?.id ?? ulid();
		contributorName = match?.name ?? name;
	}

	const assignees = ticket.props.assignees ?? [];

	if (assignees.includes(contributorId)) {
		return failed('Assignee already assigned');
	}

	const isRegistered = Boolean(getState().contributors[contributorId]);

	return materializeAndPersistAll(
		[
			...(isRegistered
				? []
				: [
						{
							id: ulid(),
							action: 'create.contributor' as const,
							payload: {
								id: contributorId,
								name: contributorName,
							},
							...actorOf(userRes.value),
						},
				  ]),
			{
				id: ulid(),
				action: 'add.issue.assignee',
				payload: {
					id: ticket.id,
					assignee: contributorId,
				},
				...actorOf(userRes.value),
			},
		],
		persistRootResult.value,
	);
};
