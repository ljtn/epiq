import {Board, Swimlane, Ticket} from './board.model.js';

export type Mode = 'default' | 'move';
export type ActionEntry<T> = {
	mode: Mode;
	key: string;
	description: string;
	action: (breadCrumb: T) => boolean | void;
};

export type ActionMap = {
	['BOARD']: ActionEntry<[Board]>[];
	['SWIMLANE']: ActionEntry<[Board, Swimlane]>[];
	['TICKET']: ActionEntry<[Board, Swimlane, Ticket]>[];
};

// const a: ActionMap = {
//   ["asdf"]: [
//     {
//       action: (a, b) => {
//         console.log(a.children, b[0].children);
//       },
//       description: "",
//       key: "",
//       mode: "default",
//     },
//   ],
// };
