export const clearScreen = () => {
  process.stdout.write("\x1B[2J\x1B[0f");
};

export const keys = {
  CTRL_C: "\u0003",
  ENTER: "\r",
  ARROW_UP: "\u001b[A",
  ARROW_DOWN: "\u001b[B",
  ARROW_LEFT: "\u001b[D",
  ARROW_RIGHT: "\u001b[C",
  ESCAPE: "\u001b",
} as const;
