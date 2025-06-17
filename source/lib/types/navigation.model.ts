export type NavigationTree<TMeta = Record<string, unknown>> = {
  id: string;
  isSelected: boolean;
  navigationMode: "vertical" | "horizontal";
  name: string;
  children: NavigationTree<unknown>[];
} & TMeta;
