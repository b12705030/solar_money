import { CheckIcon } from './ui';

export default function ProgressBar({ step, steps }: { step: number; steps: readonly string[] }) {
  return (
    <div className="progress">
      <div className="progress-row">
        {steps.map((label, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div className={`progress-step ${i === step ? 'active' : i < step ? 'done' : ''}`}>
              <div className="progress-step-num">
                {i < step ? <CheckIcon size={12} /> : i + 1}
              </div>
              <span>{label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`progress-connector ${i < step ? 'done' : ''}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
