'use client';

interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}

export function Slider({ min, max, step = 1, value, onChange }: SliderProps) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={e => onChange(+e.target.value)}
      style={{ width: '100%', '--slider-fill': `${fill}%` } as React.CSSProperties}
    />
  );
}
