import {failed, Result, succeeded} from '../model/result-types.js';
import {getSettingsState, User} from '../state/settings.state.js';
import {isValidUserId, isValidUserName} from './actor-env.js';

// Who this process writes as: the configured user, name and all. Not the
// event's actor — an event carries the id alone — but the identity the id is
// taken from, and the name a write registers its author under.
export const resolveActorId = (): Result<User> => {
	const {userName, userId} = getSettingsState();

	if (!userName) return failed('User name not configured');
	if (!userId) return failed('User ID not configured');

	if (!isValidUserId(userId)) {
		return failed('Invalid user ID in config');
	}

	if (!isValidUserName(userName)) {
		return failed('Invalid user name in config');
	}

	return succeeded('Successfully resolved actor ID', {
		userId,
		userName,
	});
};
