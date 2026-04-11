import {Box, Text} from 'ink';
import React from 'react';
import {ModeUnion} from '../model/action-map.model.js';
import {BreadCrumb, ViewMode} from '../model/app-state.model.js';
import {AnyContext, isSwimlaneNode} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {useAppState} from '../state/state.js';
import BoardList from './BoardList.js';
import {BoardUI} from './BoardUI.js';
import {Breadcrumb} from './BreadCrumb.js';
import {getSettingsState} from '../state/settings.state.js';
import chalk from 'chalk';

type Props = {
	currentNode: NavNode<AnyContext>;
	selectedIndex: number;
	breadCrumb: BreadCrumb;
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
	const {renderedChildrenIndex} = useAppState();
	const board = breadCrumb.find(({context}) => context === 'BOARD');

	return (
		<Box flexDirection="column">
			<Box justifyContent="space-between" flexDirection="row">
				<Breadcrumb />
				<Text>
					Editor:{' '}
					{chalk.bgBlack(' ' + getSettingsState().preferredEditor + ' ')}
				</Text>
			</Box>
			<Box flexDirection="row">
				{currentNode.context === 'WORKSPACE' ? (
					<BoardList />
				) : board ? (
					<BoardUI
						swimlanes={(renderedChildrenIndex[board.id] ?? []).filter(
							node => node !== undefined && isSwimlaneNode(node),
						)}
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
