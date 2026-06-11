import { CheckIcon } from './ui';

export default function ProgressBar({
  step,
  steps,
  onStepClick,
}: {
  step: number;
  steps: readonly string[];
  onStepClick?: (i: number) => void;
}) {
  return (
    <div className="progress">
      <div className="progress-row">
        {steps.map((label, i) => {
          const isDone = i < step;
          const clickable = isDone && !!onStepClick;
          return (
            <div key={i} style={{ display: 'contents' }}>
              <div
                className={`progress-step ${i === step ? 'active' : isDone ? 'done' : ''}`}
                style={clickable ? { cursor: 'pointer' } : undefined}
                onClick={clickable ? () => onStepClick(i) : undefined}
              >
                <div className="progress-step-num">
                  {isDone ? <CheckIcon size={12} /> : i + 1}
                </div>
                <span>{label}</span>
              </div>
              {i < steps.length - 1 && (
                <div className={`progress-connector ${isDone ? 'done' : ''}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
