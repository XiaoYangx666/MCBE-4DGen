import { SourceDirectory } from '../../web/shared/SourceDirectory';

/**
 * Standalone "获取模型" page for the mobile drawer. The desktop workbench
 * keeps its dialog entry point; on phones the directory is a real page.
 */
export function ModelSourcesPage() {
  return (
    <section className="sources-page">
      <div className="sources-page-head">
        <h2>获取模型</h2>
        <p>从常用站点下载模型，再回到 3D 模型页导入。</p>
      </div>
      <SourceDirectory
        allLabel="全部"
        searchPlaceholder="搜索网站、格式或地区"
        note={<>网页版推荐 GLB / glTF / VRM / OBJ；PMX 会先在浏览器内转换为 GLB，PMD 请使用桌面版。</>}
      />
    </section>
  );
}
