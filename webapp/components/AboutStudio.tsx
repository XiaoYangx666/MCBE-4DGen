import { Changelog } from '../../web/shared/Changelog';
import { BUILD_LABEL } from '../../web/shared/build-log';
import { REPO } from '../lib/links';
import { Icon } from './Icons';

export function AboutStudio() {
  return (
    <div className="info-page">
      <section className="info-card">
        <header className="info-head">
          <div className="template-icon"><Icon name="info" size={26} /></div>
          <div>
            <h2>关于 4DGen</h2>
            <p>把模型和图片转换成 Minecraft Bedrock 4D 皮肤，全程在当前浏览器完成。</p>
          </div>
        </header>

        <div className="info-facts">
          <div className="info-fact">
            <span>当前构建</span>
            <b>{BUILD_LABEL}</b>
          </div>
          <div className="info-fact">
            <span>运行方式</span>
            <b>纯浏览器 · 无服务端</b>
          </div>
          <div className="info-fact">
            <span>数据位置</span>
            <b>当前浏览器 IndexedDB</b>
          </div>
          <div className="info-fact">
            <span>许可证</span>
            <b>GPL-3.0</b>
          </div>
        </div>

        <div className="info-section">
          <h3>版本记录</h3>
          <Changelog drawer />
        </div>

        <div className="info-section">
          <h3>链接</h3>
          <div className="info-actions">
            <a className="button-link" href={REPO} target="_blank" rel="noreferrer">
              <Icon name="github" size={15} />
              项目主页
              <span aria-hidden="true">↗</span>
            </a>
          </div>
        </div>

        <div className="info-section">
          <h3>本机处理</h3>
          <p className="info-note">
            图片、模型、贴图和生成结果都在当前浏览器内处理，不会上传到服务器。没有账号、遥测或上传接口。
          </p>
        </div>
      </section>
    </div>
  );
}
