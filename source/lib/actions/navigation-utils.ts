import {NavigateCtx} from '../navigation-context.js';
import {Key} from 'readline';

export function movePreviousKey({name}: Key, ctx: NavigateCtx): boolean {
	const axis = ctx.navigationNode.childrenRenderAxis;
	return (
		(axis === 'horizontal' && name === 'left') ||
		(axis === 'vertical' && name === 'up')
	);
}

export function moveNextKey({name}: Key, ctx: NavigateCtx): boolean {
	const axis = ctx.navigationNode.childrenRenderAxis;
	return (
		(axis === 'horizontal' && name === 'right') ||
		(axis === 'vertical' && name === 'down')
	);
}

export const isMovePreviousKey = (
	key: Key,
	ctx: NavigateCtx,
): {isMatch: boolean} => ({
	isMatch: movePreviousKey(key, ctx),
});

export const isMoveNextKey = (
	key: Key,
	ctx: NavigateCtx,
): {isMatch: boolean} => ({
	isMatch: moveNextKey(key, ctx),
});
