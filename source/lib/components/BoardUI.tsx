import {Box} from 'ink';
import React from 'react';
import {ModeUnion} from '../model/action-map.model.js';
import {BreadCrumb, ViewMode} from '../model/app-state.model.js';
import {
	AnyContext,
	NavNodeCtx,
	Swimlane,
	Ticket,
} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {DeepReadonly} from '../model/readonly.model.js';
import {SwimlaneUI} from './Swimlane.js';
import {TicketUI} from './TicketUI.js';

type Props = {
	swimlanes: readonly Swimlane[];
	contextNode: NavNode<AnyContext>;
	selectedIndex: number;
	breadCrumb: DeepReadonly<BreadCrumb>;
	viewMode: ViewMode;
	mode: ModeUnion;
	height: number;
	width: number;
};

const BoardUIComponent: React.FC<Props> = ({
	swimlanes,
	contextNode,
	selectedIndex,
	breadCrumb,
	mode,
	viewMode,
	height,
	width,
}) => {
	const actionContext = contextNode.context;

	const isTicketContext =
		actionContext === NavNodeCtx.TICKET ||
		actionContext === NavNodeCtx.FIELD_LIST ||
		actionContext === NavNodeCtx.FIELD;

	const isSwimlaneContext =
		actionContext === NavNodeCtx.BOARD || actionContext === NavNodeCtx.SWIMLANE;

	const ticketFromCrumb =
		actionContext === NavNodeCtx.TICKET
			? (contextNode as Ticket)
			: (breadCrumb.find(n => n.context === NavNodeCtx.TICKET) as
					| Ticket
					| undefined);

	const swimlaneMaxWidth = Math.floor(width / 3);
	const swimlaneDynamicWidth = Math.floor(
		width / Math.max(swimlanes.length, 1),
	);
	const colWidth = Math.min(swimlaneDynamicWidth, swimlaneMaxWidth);

	const isDense = viewMode === 'dense';

	return (
		<Box flexDirection="row" height={height}>
			{isSwimlaneContext &&
				swimlanes.map((lane, index) => {
					const isFocused = contextNode.id === lane.id;
					const listSelectedIndex = isFocused ? selectedIndex : -1;
					const isSelected =
						contextNode.context === NavNodeCtx.BOARD && selectedIndex === index;

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
						/>
					);
				})}

			{isTicketContext && ticketFromCrumb && (
				<TicketUI height={height} ticket={ticketFromCrumb} />
			)}
		</Box>
	);
};

export const BoardUI = React.memo(BoardUIComponent);
