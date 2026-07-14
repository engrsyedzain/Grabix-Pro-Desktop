import React from 'react';
import { Check } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Step {
  id: number;
  label: string;
}

interface StepsIndicatorProps {
  steps: Step[];
  currentStep: number;
}

const StepsIndicator: React.FC<StepsIndicatorProps> = ({ steps, currentStep }) => {
  return (
    <div className="px-7 py-6 flex items-center justify-between">
      {steps.map((step, index) => {
        const isCompleted = currentStep > step.id;
        const isActive = currentStep === step.id;

        return (
          <React.Fragment key={step.id}>
            <div className="flex flex-col items-center flex-1">
              <div
                className={cn(
                  "w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors",
                  isCompleted ? "bg-green-500 text-white" : 
                  isActive ? "bg-grabix-purple text-white" : 
                  "bg-grabix-surface dark:bg-grabix-input-dark text-grabix-dim"
                )}
              >
                {isCompleted ? <Check size={18} /> : step.id}
              </div>
              <span 
                className={cn(
                  "mt-2 text-[10px] transition-colors",
                  isCompleted ? "text-green-500 font-bold" :
                  isActive ? "text-black dark:text-white font-bold" :
                  "text-grabix-dim"
                )}
              >
                {step.label.toUpperCase()}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div className="flex-1 h-px bg-grabix-border dark:bg-grabix-border-dark mt-[-18px]" />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

export default StepsIndicator;
