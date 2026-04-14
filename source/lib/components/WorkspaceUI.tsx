import chalk from 'chalk';
import {Box, Text} from 'ink';
import React from 'react';
import {ModeUnion} from '../model/action-map.model.js';
import {BreadCrumb, ViewMode} from '../model/app-state.model.js';
import {AnyContext, isSwimlaneNode} from '../model/context.model.js';
import {NavNode} from '../model/navigation-node.model.js';
import {getSettingsState} from '../state/settings.state.js';
import {useAppState} from '../state/state.js';
import BoardList from './BoardList.js';
import {BoardUI} from './BoardUI.js';
import {Breadcrumb} from './BreadCrumb.js';
import {FilterUI} from './Filters.js';

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
	const filters = useAppState().filters;
	return (
		<Box flexDirection="column">
			<Box justifyContent="space-between" flexDirection="row">
				<Box paddingLeft={1}>
					{filters.length ? (
						<FilterUI filters={filters}></FilterUI>
					) : (
						<Breadcrumb />
					)}
				</Box>
				<Box columnGap={1} paddingRight={2}>
					<Text>
						{chalk.dim('@') +
							chalk.magenta(' ' + getSettingsState().userName + ' ')}
					</Text>
					<Text>
						{chalk.dim('❯') +
							chalk.magenta(' ' + getSettingsState().preferredEditor + ' ')}
					</Text>
				</Box>
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
