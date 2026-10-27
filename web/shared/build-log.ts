/**
 * Build history shared by the desktop workbench and the browser web app.
 *
 * There is no public release yet, so entries are Beta build codes instead of
 * semantic versions. When a release is cut, keep the entries and merge the
 * builds covered by that release into one release section.
 */

export type ChangelogTag = '新增' | '修复' | '优化' | '重构';

export interface ChangelogChange {
  tag?: ChangelogTag;
  text: string;
}

export interface ChangelogEntry {
  /** Beta build code shown in the UI, e.g. 2026.10.26.3. */
  build: string;
  date: string;
  title: string;
  changes: ChangelogChange[];
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    build: '2026.10.27.1',
    date: '2026-10-27',
    title: '手机端侧边栏整理',
    changes: [
      { tag: '优化', text: '侧边栏拆成「工作台 / 外观 / 关于」三栏，页面切换、主题配色和更新日志不再挤在一起。' },
      { tag: '优化', text: '收紧顶部、分组和底部留白，导航行与配色行更紧凑。' },
      { tag: '优化', text: '更新日志移到「关于」栏，底部不再堆放多个入口。' },
    ],
  },
  {
    build: '2026.10.26.4',
    date: '2026-10-26',
    title: '构建号与更新日志',
    changes: [
      { tag: '新增', text: '桌面工作台、桌面应用和网页版共用 Beta 构建号与更新日志弹窗。' },
      { tag: '新增', text: '顶栏、关于弹窗、设置页和移动端抽屉都可以查看当前构建与历史更新。' },
      { tag: '优化', text: '更新日志数据集中在 web/shared/build-log.ts，正式发版后可以把多个构建合并成版本记录。' },
    ],
  },
  {
    build: '2026.10.26.3',
    date: '2026-10-26',
    title: '绑定规则共享',
    changes: [
      { tag: '重构', text: '桌面端与网页端共用六部位角色映射、玩家骨架、轴心和三角面归属算法。' },
      { tag: '优化', text: '新增 src/humanoid-binding.ts，避免两套绑定逻辑继续漂移。' },
    ],
  },
  {
    build: '2026.10.26.2',
    date: '2026-10-26',
    title: '网页版六部位与包名修复',
    changes: [
      { tag: '新增', text: '网页版自动识别 VRM / 常见 MMD / Mixamo 人形骨骼，导出头、躯干、双臂和双腿。' },
      { tag: '新增', text: '按源蒙皮权重划分三角面，并按部位边界分开减面。' },
      { tag: '修复', text: '本地工作台生成的包名不再追加「 / 本地工作台」，并去掉模型文件扩展名。' },
      { tag: '修复', text: '下载 ZIP 不再固定叫 skin.zip；网页版首次建包使用皮肤名，导入包会解析本地化包名。' },
    ],
  },
  {
    build: '2026.10.26.1',
    date: '2026-10-26',
    title: '网页版上线',
    changes: [
      { tag: '新增', text: '纯浏览器网页版部署到 Cloudflare Workers，可直接通过 workers.dev 使用。' },
      { tag: '优化', text: '复用皮肤包构建、ZIP 写入、预览、主题和转换报告等共享模块。' },
      { tag: '优化', text: '完善移动端模型工作流、获取模型入口和单包导出。' },
    ],
  },
  {
    build: '2026.10.25.1',
    date: '2026-10-25',
    title: '网页版三维预览',
    changes: [
      { tag: '新增', text: '新增 poly_mesh 输出预览、光照开关和正面检查。' },
      { tag: '优化', text: '网页版与桌面端共享预览外壳、灯光、前向指示和按需渲染。' },
      { tag: '新增', text: '皮肤包单包管理、ZIP 导入导出和模型站点目录。' },
    ],
  },
  {
    build: '2026.10.24.1',
    date: '2026-10-24',
    title: '纯浏览器工作流',
    changes: [
      { tag: '新增', text: '新增图片皮肤与 3D 模型的独立网页版，不需要本地 Node 服务。' },
      { tag: '新增', text: '支持 GLB / glTF / VRM / OBJ / PMX 的浏览器内转换。' },
      { tag: '优化', text: '平铺 ZIP 导出、移动端下载和浏览器本地皮肤包。' },
    ],
  },
  {
    build: '2026.10.19.1',
    date: '2026-10-19',
    title: '桌面工作台',
    changes: [
      { tag: '新增', text: 'Electron 桌面壳与 Node 本地运行时。' },
      { tag: '新增', text: '皮肤包管理、设置、图片模板与模型库。' },
      { tag: '优化', text: '工作台三栏布局、三维预览和可恢复的皮肤包操作。' },
    ],
  },
];

/** Newest build first. Every UI should show this same value. */
export const CURRENT_BUILD = CHANGELOG[0]!;

/** Short label used in headers and badges. */
export const BUILD_LABEL = `BETA ${CURRENT_BUILD.build}`;

/** Note shown at the top of the build log. */
export const CHANGELOG_NOTE =
  '当前是 Beta 构建，版本号按构建递增。正式发版后会把覆盖的多个构建合并成一个版本记录。';
