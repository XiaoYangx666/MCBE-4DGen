import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversionSummary } from '../web/shared/ConversionSummary.tsx';

describe('shared conversion summary', () => {
  it('renders the shared metrics, atlas utilization and host extras', () => {
    const markup = renderToStaticMarkup(
      createElement(
        ConversionSummary,
        {
          triangles: 1234,
          removedMaterials: 2,
          stale: true,
          timing: '完整生成用时 1.2 秒',
          atlas: { allocatedUtilization: 0.5, sampledUtilization: 0.25 },
          facts: '源三角面 2,000',
          materials: [{ name: 'body', pixels: 100 }],
          totalPixels: 16_384,
        },
        createElement('details', null, createElement('summary', null, '额外明细')),
      ),
    );

    expect(markup).toContain('1,234');
    expect(markup).toContain('已移除 2 个材质');
    expect(markup).toContain('参数已修改，请重新转换');
    expect(markup).toContain('完整生成用时 1.2 秒');
    expect(markup).toContain('包间空白 50.0%');
    expect(markup).toContain('实际非透明 UV 覆盖 25.0%');
    expect(markup).toContain('源三角面 2,000');
    expect(markup).toContain('body');
    expect(markup).toContain('额外明细');
  });

  it('keeps the host notice between the summary and the material rows', () => {
    const markup = renderToStaticMarkup(
      createElement(ConversionSummary, {
        triangles: 4,
        removedMaterials: 0,
        stale: false,
        notice: createElement('p', { className: 'inline-note' }, '重新转换后可查看统计'),
        materials: [],
        totalPixels: 16_384,
      }),
    );

    expect(markup).toContain('未移除材质');
    expect(markup).toContain('重新转换后可查看统计');
    expect(markup).not.toContain('material-allocation');
  });
});
