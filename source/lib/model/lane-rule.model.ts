// The rules a lane can carry: what standing in it means for its tickets. Plain
// data, so the browser reads the same names the log is written with.

export const LANE_RULES = ['done'] as const;
export type LaneRule = (typeof LANE_RULES)[number];

export const isLaneRule = (rule: string): rule is LaneRule =>
	(LANE_RULES as readonly string[]).includes(rule);
