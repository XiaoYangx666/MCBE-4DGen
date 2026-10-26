export interface PoseControlsProps {
  rotationY: number;
  onRotationY: (value: number) => void;
  armSpread?: number;
  onArmSpread?: (value: number) => void;
  showArm?: boolean;
  armAvailable?: boolean;
  armMin?: number;
  armMax?: number;
  armLabel?: string;
  disabled?: boolean;
  rotationHelp?: string;
  armHelp?: string;
}

/**
 * Shared Y-rotation and arm-spread controls for the desktop workbench and the
 * browser model studio. The caller owns the pose state and preview.
 */
export function PoseControls({
  rotationY,
  onRotationY,
  armSpread = 0,
  onArmSpread,
  showArm = false,
  armAvailable = true,
  armMin = -45,
  armMax = 90,
  armLabel = '手臂下放',
  disabled = false,
  rotationHelp = '源模型实时旋转，转换时按这个朝向导出。',
  armHelp = '实时预览。0° 保持源姿势，正值向下放；转换时把当前姿势烘焙进静态网格。',
}: PoseControlsProps) {
  return (
    <div className="pose-controls">
      <div className="pose-field">
        <div className="pose-field-head">
          <span>Y 轴旋转</span>
          <b>{rotationY}°</b>
        </div>
        <input
          type="range"
          min={-180}
          max={180}
          step={5}
          value={rotationY}
          disabled={disabled}
          aria-label="Y 轴旋转"
          onChange={(event) => onRotationY(Number(event.target.value))}
        />
        <div className="pose-presets">
          {[0, 90, 180, -90].map((angle) => (
            <button
              key={angle}
              type="button"
              className={rotationY === angle ? 'active' : ''}
              disabled={disabled}
              onClick={() => onRotationY(angle)}
            >
              {angle}°
            </button>
          ))}
        </div>
        <p className="pose-help">{rotationHelp}</p>
      </div>

      {showArm && (
        <div className="pose-field">
          <div className="pose-field-head">
            <span>{armLabel}</span>
            <b>{armAvailable ? `${armSpread}°` : '未识别'}</b>
          </div>
          <input
            type="range"
            min={armMin}
            max={armMax}
            step={5}
            value={armSpread}
            disabled={disabled || !armAvailable}
            aria-label="手臂下放"
            onChange={(event) => onArmSpread?.(Number(event.target.value))}
          />
          <p className="pose-help">
            {armAvailable
              ? armHelp
              : '没有识别到左右上臂和手/肘骨骼；带骨骼的 VRM / PMX / GLB 才支持。'}
          </p>
        </div>
      )}
    </div>
  );
}
