import {render} from 'ink';
import meow from 'meow';
import React from 'react';
import App from './app.js';
import {initProject} from './InitView.js';
import {initListeners} from './lib/listeners/keypress-listener.js';
import './logger.js';
import Logo from './lib/components/Logo.js';
import {monotonicFactory} from 'ulid';
import {loadMergedEvents} from './event/event-load.js';
import {AppEvent} from './event/event.model.js';
import {materializeAndPersistAll} from './event/event-materialize-and-persist.js';
import {materializeAll} from './event/event-materialize.js';
import {isFail} from './lib/command-line/command-types.js';
import {getState} from './lib/state/state.js';
import {getOrderedChildren} from './repository/rank.js';
import {navigationUtils} from './lib/actions/default/navigation-action-utils.js';

const cli = meow(
	`
	  View board in directory:
	  $ epiq

	  Init project in directory:
	  $ epiq --init "Project Name"
`,
	{
		importMeta: import.meta,
		flags: {
			init: {type: 'string'},
		},
	},
);

const nextId = monotonicFactory();

export const bootStateFromEventLog = () => {
	const eventLog = loadMergedEvents();
	let allMaterialized;

	if (!eventLog.length) {
		const workspaceId = nextId();
		const boardId = nextId();
		const swimlaneId1 = nextId();
		const swimlaneId2 = nextId();
		const swimlaneId3 = nextId();

		const events = [
			{
				action: 'init.workspace',
				payload: {id: workspaceId, name: 'Workspace'},
			},
			{
				action: 'add.board',
				payload: {id: boardId, name: 'Default', parentId: workspaceId},
			},
			{
				action: 'add.swimlane',
				payload: {id: swimlaneId1, name: 'Todo', parentId: boardId},
			},
			{
				action: 'add.swimlane',
				payload: {id: swimlaneId2, name: 'Review', parentId: boardId},
			},
			{
				action: 'add.swimlane',
				payload: {id: swimlaneId3, name: 'Done', parentId: boardId},
			},
		] as const satisfies readonly AppEvent[];

		allMaterialized = materializeAndPersistAll(events);
	} else {
		allMaterialized = materializeAll(eventLog);
	}

	const failedResults = allMaterialized.filter(isFail);
	if (failedResults.length) {
		throw new Error(
			'Failed to materialize events on boot: ' +
				failedResults.map(x => x.message ?? 'Unknown error').join(', '),
		);
	}

	const workspace = Object.values(getState().nodes).find(
		node => node.context === 'WORKSPACE',
	);
	if (!workspace) {
		logger.error('No workspace found in event log');
		throw new Error('No workspace found in event log');
	}

	const [firstBoard] = getOrderedChildren(workspace.id);
	const [firstSwimlane] = firstBoard ? getOrderedChildren(firstBoard.id) : [];

	const navigationTarget = firstSwimlane ?? firstBoard ?? workspace;

	navigationUtils.navigate({
		currentNode: navigationTarget,
		selectedIndex: getState().renderedChildrenIndex?.[navigationTarget.id]
			?.length
			? 0
			: -1,
	});
};

let ink: ReturnType<typeof render> | null = null;

const renderApp = () => {
	if (!ink) {
		ink = render(<App />);
	} else {
		ink.rerender(<App />);
	}
};
const renderLoader = () => {
	if (!ink) {
		ink = render(<Logo />);
	} else {
		ink.rerender(<Logo />);
	}
};

const bootState = async () => {
	await new Promise((resolve, reject) => {
		try {
			const now = Date.now();
			bootStateFromEventLog();
			const bootTime = Date.now() - now;
			if (bootTime < 500) {
				// If boot is very fast, add a small delay to show the loader
				const newBootTime = 3_000 - bootTime;
				logger.debug(`Recalculating boot time with delay: ${newBootTime}ms`);
				setTimeout(() => resolve(null), newBootTime);
			} else {
				resolve(null);
			}
		} catch (error) {
			reject(error);
		}
	});
};

process.stdout.on('resize', () => {
	if (ink) ink.rerender(<App />);
});

(async () => {
	console.clear();
	if (cli.flags.init) {
		initProject();
		return;
	}

	if (!Object.keys(cli.flags).length) {
		renderLoader();
		await bootState();

		renderApp();

		initListeners();
	}
})();
