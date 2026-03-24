import {Box, Text} from 'ink';
import React from 'react';
import {ModeUnion} from '../model/action-map.model.js';
import {AppState, BreadCrumb, ViewMode} from '../model/app-state.model.js';
import {AnyContext, isSwimlaneNode} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {filterMap} from '../utils/array.utils.js';
import BoardList from './BoardList.js';
import {BoardUI} from './BoardUI.js';
import {Breadcrumb} from './BreadCrumb.js';

type Props = {
	currentNode: NavNode<AnyContext>;
	selectedIndex: number;
	breadCrumb: BreadCrumb;
	viewMode: ViewMode;
	mode: ModeUnion;
	nodes: AppState['nodes'];
};
const WorkspaceUIComponent: React.FC<Props> = ({
	currentNode,
	selectedIndex,
	breadCrumb,
	mode,
	viewMode,
	nodes,
}) => {
	const board = breadCrumb.find(({context}) => context === 'BOARD');

	return (
		<Box flexDirection="column">
			<Breadcrumb />
			<Box flexDirection="row">
				{currentNode.context === 'WORKSPACE' ? (
					<BoardList />
				) : board ? (
					<BoardUI
						swimlanes={filterMap(board.children, id => {
							const node = nodes[id];
							if (!node) return null;
							return isSwimlaneNode(node) ? node : null;
						})}
						currentNode={currentNode}
						selectedIndex={selectedIndex}
						breadCrumb={breadCrumb}
						viewMode={viewMode}
						mode={mode}
						nodes={nodes}
					/>
				) : (
					<Text />
				)}
			</Box>
		</Box>
	);
};

export const WorkspaceUI = React.memo(WorkspaceUIComponent);
