const COLORS = {
  green: "\x1b[32m",
  gray: "\x1b[90m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  default: null, // no color
} as const;

const RESET = "\x1b[0m";

export type HighlightColor = keyof typeof COLORS;

export const highlight = (str: string, color: HighlightColor = "default") => {
  const prefix = COLORS[color];
  return prefix ? `${prefix}${str}${RESET}` : str;
};
