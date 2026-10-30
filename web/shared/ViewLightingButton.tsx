import { Icon } from './Icons';

/**
 * Shared lighting toggle for every 3D preview (workbench viewer, skin-pack
 * previews, templates). `unlit` is the state of the scene: true means flat /
 * no lighting.
 */
export function ViewLightingButton({
  unlit,
  onChange,
  className,
}: {
  unlit: boolean;
  onChange: (unlit: boolean) => void;
  className?: string;
}) {
  const label = unlit ? '开启光影' : '关闭光影';
  return (
    <button
      type="button"
      className={`view-lighting-button${unlit ? '' : ' active'}${
        className ? ` ${className}` : ''
      }`}
      aria-pressed={!unlit}
      aria-label={label}
      title={label}
      onClick={() => onChange(!unlit)}
    >
      <Icon name="sun" size={15} />
    </button>
  );
}
