import {getGuiState} from '../../../mcp/epiq-api.js';
import {runExclusive} from '../../../mcp/epiq-time-travel.js';

// The board, loaded while the browser starts rather than when it first asks.
let warmed: Promise<void> = Promise.resolve();

/** Boots the board under the lock, then runs `afterBoot`; a failure is left to the first read. */
export const warmBoard = (
	repoRoot: string,
	afterBoot: () => void = () => {},
): Promise<void> => {
	warmed = runExclusive(async () => {
		await getGuiState({repoRoot});
		afterBoot();
	}).then(
		() => undefined,
		() => undefined,
	);

	return warmed;
};

/** Resolves once the warm-up is over, at once if there was none. */
export const boardWarmed = (): Promise<void> => warmed;
