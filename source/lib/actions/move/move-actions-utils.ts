import {nodeRepository} from '../../repository/node-repository.js';
import {navigationUtils} from '../default/navigation-action-utils.js';

export function moveNodeToSiblingContainer(direction: -1 | 1) {
	const result = nodeRepository.moveNodeToSiblingContainer(direction);
	if (!result) return;

	navigationUtils.navigate({
		// if your navigator supports currentNode by id, use that,
		// otherwise pass selectedIndex only and rely on state refresh.
		selectedIndex: result.selectedIndex,
	});
}

export function moveChildWithinParent(direction: -1 | 1) {
	const to = nodeRepository.moveChildWithinParent(direction);
	if (to == null) return;

	navigationUtils.navigate({selectedIndex: to});
}
