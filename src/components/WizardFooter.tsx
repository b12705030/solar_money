'use client';
import { ChevronIcon } from './ui';

export default function WizardFooter({
  step, steps, canAdvance, onBack, onNext,
}: {
  step: number;
  steps: readonly string[];
  canAdvance: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="wizard-footer">
      <button className="btn-nav" onClick={onBack}>
        <ChevronIcon dir="left" /> 上一步
      </button>
      <span className="step-hint">
        Step <b className="num" style={{ color: 'var(--green-700)' }}>{step + 1}</b> / 4 · {steps[step]}
      </span>
      <button
        className="btn btn-primary"
        onClick={onNext}
        disabled={!canAdvance}
        style={{ opacity: canAdvance ? 1 : 0.5, pointerEvents: canAdvance ? 'auto' : 'none' }}
      >
        {step === 3 ? '看結果' : '下一步'}
        <ChevronIcon dir="right" size={14} />
      </button>
    </div>
  );
}
