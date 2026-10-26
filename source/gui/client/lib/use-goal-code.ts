// A goal's Code and Stats tabs: a ticket's commits and code stats, over every
// ticket in the goal. Each asked for when its tab opens, and again when the
// goal's tickets, their commits or the cut change.

import {useCallback, useEffect, useRef, useState} from 'react';
// Types only, from modules that declare nothing but types.
import {RefDiffStats} from '../../../lib/stats/ref-diff-stats.model.js';
import {GuiBoard} from './gui-state.model';
import {getResultValue} from './gui-state-helper';

// FNV-1a: enough to tell one signature from the next.
const hashOf = (text: string): string => {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
	}
	return (hash >>> 0).toString(36);
};

/** Which tickets a goal holds, and what each one's commits add up to. */
export const goalCodeSignature = (
	goalId: string,
	boards: GuiBoard[],
	diffStats: RefDiffStats,
): string => {
	const members = new Set(
		boards.flatMap(
			board =>
				board.goals
					.find(goal => goal.id === goalId)
					?.members.map(member => member.id) ?? [],
		),
	);
	return boards
		.flatMap(board => board.swimlanes.flatMap(lane => lane.issues))
		.filter(issue => members.has(issue.id))
		.map(issue => {
			const diff = diffStats[issue.ref];
			return `${issue.id}:${diff?.commits ?? 0}:${diff?.insertions ?? 0}:${
				diff?.deletions ?? 0
			}`;
		})
		.sort()
		.join(',');
};

export type GoalAnswer<T> = {
	goalId: string;
	loading: boolean;
	error: string | null;
	value: T | null;
};

// `goal:<kind>:get`, answered by `goal:<kind>:result`.
type GoalAsk = 'stats' | 'commits';

export const useGoalAnswer = <T>({
	ask,
	goalId,
	signature,
	asOfTime,
	socketEpoch,
	sendRaw,
}: {
	ask: GoalAsk;
	// Null while the tab is closed.
	goalId: string | null;
	// From goalCodeSignature.
	signature: string;
	asOfTime: number | null;
	// A reconnect asks again: an answer on the old socket never arrives.
	socketEpoch: number;
	sendRaw: (message: unknown) => void;
}) => {
	const [answer, setAnswer] = useState<GoalAnswer<T> | null>(null);
	const asked = useRef<string | null>(null);

	useEffect(() => {
		if (!goalId) {
			setAnswer(null);
			asked.current = null;
			return;
		}

		// Hashed, so the key stays small however many tickets the goal holds.
		const key = `${goalId}:${hashOf(signature)}:${
			asOfTime ?? ''
		}:${socketEpoch}`;
		if (asked.current === key) return;
		asked.current = key;

		// The last answer stays up while a new one is on its way.
		setAnswer(prev => ({
			goalId,
			loading: true,
			error: null,
			value: prev?.goalId === goalId ? prev.value : null,
		}));
		sendRaw({
			type: `goal:${ask}:get`,
			payload: asOfTime === null ? {goalId, key} : {goalId, key, asOfTime},
		});
	}, [ask, goalId, signature, asOfTime, socketEpoch, sendRaw]);

	const onMessage = useCallback(
		(message: any) => {
			if (message.type !== `goal:${ask}:result`) return;

			const {key, result} = message.payload as {
				key: string;
				result: {status: string; message: string; value?: T};
			};
			// An answer to anything but the latest ask is already out of date.
			if (key !== asked.current) return;

			setAnswer(prev => {
				if (!prev) return prev;
				if (result?.status === 'fail') {
					return {...prev, loading: false, error: result.message};
				}
				const next = getResultValue<T>(result);
				return next
					? {...prev, loading: false, error: null, value: next}
					: prev;
			});
		},
		[ask],
	);

	return {answer, onMessage};
};
