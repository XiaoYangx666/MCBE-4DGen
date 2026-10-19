export const pages = [
  { key: "home", label: "概览", href: "#/" },
  { key: "models", label: "源模型", href: "#/models" },
  { key: "workbench", label: "工作台", href: "#/workbench" },
  { key: "templates", label: "皮肤模板", href: "#/templates" },
  { key: "packs", label: "皮肤包", href: "#/packs" },
  { key: "settings", label: "设置", href: "#/settings" },
] as const;

export type PageKey = (typeof pages)[number]["key"];

export const pageTitles: Record<PageKey, string> = {
  home: "首页",
  models: "源模型",
  workbench: "工作台",
  templates: "皮肤模板",
  packs: "皮肤包",
  settings: "设置",
};

const ROUTES: { prefix: string; page: PageKey }[] = [
  { prefix: "#/settings", page: "settings" },
  { prefix: "#/templates", page: "templates" },
  { prefix: "#/models", page: "models" },
  { prefix: "#/game", page: "packs" },
  { prefix: "#/packs", page: "packs" },
  { prefix: "#/workbench", page: "workbench" },
];

export function pageFromHash(hash: string): PageKey {
  return ROUTES.find((route) => hash.startsWith(route.prefix))?.page ?? "home";
}
