import {ActionMap} from './types/action-map.model.js';
import {navigate} from './navigation.js';
import {BoardItemTypes} from './types/board.model.js';
import {keys} from './utils.js';

export const Actions: ActionMap = {
	[BoardItemTypes.BOARD]: [],
	[BoardItemTypes.SWIMLANE]: [
		{
			key: keys.ARROW_DOWN,
			mode: 'default',
			description: '[ARROW_DOWN] - Enter swimlane',
			action: () => {
				// navigate({
				//   breadCrumb: [board, swimlane, swimlane.children[0]],
				//   callbacks: { render: () => renderBoard },
				// });
			},
		},
	],
	[BoardItemTypes.TICKET]: [
		{
			key: 'm',
			mode: 'default',
			description: 'm = Move ticket',
			action: ([board]) => {
				// navigationState.mode = "move";
				navigate({
					breadCrumb: [board],
					callbacks: {
						// render: () => renderBoard(board),
						onSelectChange: () => {
							// const realDestination = findNodeById(board, selected.id);
							// if (realDestination?.type === BoardItemTypes.SWIMLANE) {
							//   moveTicket(ticket, realDestination);
							//   // bootBoard();
							// }
						},
						onExit: () => {
							console.log('make api call');
							// navigationState.mode = "default";
						},
					},
				});
			},
		},
	],
} as const;
