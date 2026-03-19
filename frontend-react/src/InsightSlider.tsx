import { useEffect, useState } from 'react';

interface InsightSliderProps {
  insights: string[];
}

export function InsightSlider({ insights }: InsightSliderProps) {
  const safeInsights = insights.length > 0 ? insights : ['Aguardando analise do clima atual.'];
  const [currentIndex, setCurrentIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setCurrentIndex(0);
    setVisible(true);
  }, [safeInsights.join('|')]);

  useEffect(() => {
    if (safeInsights.length <= 1) {
      return;
    }

    let timeoutId: number | undefined;
    const interval = setInterval(() => {
      setVisible(false);

      timeoutId = window.setTimeout(() => {
        setCurrentIndex((previousIndex) => (previousIndex + 1) % safeInsights.length);
        setVisible(true);
      }, 260);
    }, 6500);

    return () => {
      clearInterval(interval);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [safeInsights]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {safeInsights.map((_, index) => (
          <span
            key={`insight-dot-${index}`}
            className={`h-2.5 rounded-full transition-all duration-300 ${
              index === currentIndex ? 'w-8 bg-white' : 'w-2.5 bg-white/35'
            }`}
          />
        ))}
        <span className="ml-2 text-xs font-semibold uppercase tracking-[0.24em] text-white/70">
          {currentIndex + 1}/{safeInsights.length}
        </span>
      </div>

      <div className="flex min-h-[6.5rem] items-center">
        <p
          className={`text-xl font-medium leading-snug text-white transition-all duration-300 sm:text-2xl ${
            visible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
          }`}
        >
          "{safeInsights[currentIndex]}"
        </p>
      </div>
    </div>
  );
}
