import {Box} from 'ink';
import React from 'react';
import {ModeUnion} from '../model/action-map.model.js';
import {AppState, BreadCrumb, ViewMode} from '../model/app-state.model.js';
import {
	AnyContext,
	NavNodeCtx,
	Swimlane,
	Ticket,
} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {SwimlaneUI} from './Swimlane.js';
import {TicketUI} from './TicketUI.js';
import {DeepReadonly} from '../model/readonly.model.js';

type Props = {
	swimlanes: readonly Swimlane[];
	currentNode: NavNode<AnyContext>;
	selectedIndex: number;
	breadCrumb: DeepReadonly<BreadCrumb>;
	viewMode: ViewMode;
	mode: ModeUnion;
	nodes: AppState['nodes'];
};

const BoardUIComponent: React.FC<Props> = ({
	swimlanes,
	currentNode,
	selectedIndex,
	breadCrumb,
	mode,
	viewMode,
	nodes,
}) => {
	const actionContext = currentNode.context;

	const isTicketContext =
		actionContext === NavNodeCtx.TICKET ||
		actionContext === NavNodeCtx.FIELD_LIST ||
		actionContext === NavNodeCtx.FIELD;

	const isSwimlaneContext =
		actionContext === NavNodeCtx.BOARD || actionContext === NavNodeCtx.SWIMLANE;

	const ticketFromCrumb =
		actionContext === NavNodeCtx.TICKET
			? (currentNode as Ticket)
			: (breadCrumb.find(n => n.context === NavNodeCtx.TICKET) as
					| Ticket
					| undefined);

	const width = process.stdout.columns || 120;
	const swimlaneMaxWidth = Math.floor(width / 3);
	const swimlaneDynamicWidth = Math.floor(
		width / Math.max(swimlanes.length, 1),
	);
	const colWidth = Math.min(swimlaneDynamicWidth, swimlaneMaxWidth);

	const breadCrumbHeight = 1;
	const commandLineHeight = 3;
	const height = process.stdout.rows - breadCrumbHeight - commandLineHeight;

	const isDense = viewMode === 'dense';

	return (
		<Box flexDirection="row" height={height}>
			{isSwimlaneContext &&
				swimlanes.map((lane, index) => {
					const isFocused = currentNode.id === lane.id;
					const listSelectedIndex = isFocused ? selectedIndex : -1;
					const isSelected =
						currentNode.context === NavNodeCtx.BOARD && selectedIndex === index;

					return (
						<SwimlaneUI
							key={lane.id}
							height={height}
							width={colWidth}
							swimlane={lane}
							isSelected={isSelected}
							isDense={isDense}
							isFocused={isFocused}
							listSelectedIndex={listSelectedIndex}
							mode={mode}
							nodes={nodes}
						/>
					);
				})}

			{isTicketContext && ticketFromCrumb && (
				<TicketUI height={height} ticket={ticketFromCrumb} nodes={nodes} />
			)}
		</Box>
	);
};

export const BoardUI = React.memo(BoardUIComponent);
