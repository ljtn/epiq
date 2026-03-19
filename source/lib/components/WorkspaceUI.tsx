import {Box, Text} from 'ink';
import React from 'react';
import {ModeUnion} from '../model/action-map.model.js';
import {BreadCrumb, ViewMode} from '../model/app-state.model.js';
import {AnyContext} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {DeepReadonly} from '../model/readonly.model.js';
import BoardList from './BoardList.js';
import {BoardUI} from './BoardUI.js';
import {Breadcrumb} from './BreadCrumb.js';

type Props = {
	currentNode: NavNode<AnyContext>;
	selectedIndex: number;
	breadCrumb: DeepReadonly<BreadCrumb>;
	viewMode: ViewMode;
	mode: ModeUnion;
};
const WorkspaceUIComponent: React.FC<Props> = ({
	currentNode,
	selectedIndex,
	breadCrumb,
	mode,
	viewMode,
}) => {
	const board =
		breadCrumb.length >= 2 && breadCrumb[1]?.context === 'BOARD'
			? breadCrumb[1]
			: undefined;

	return (
		<Box flexDirection="column">
			<Breadcrumb />
			<Box flexDirection="row">
				{currentNode.context === 'WORKSPACE' ? (
					<BoardList />
				) : board ? (
					<BoardUI
						swimlanes={board.children}
						currentNode={currentNode}
						selectedIndex={selectedIndex}
						breadCrumb={breadCrumb}
						viewMode={viewMode}
						mode={mode}
					/>
				) : (
					<Text />
				)}
			</Box>
		</Box>
	);
};

export const WorkspaceUI = React.memo(WorkspaceUIComponent);
