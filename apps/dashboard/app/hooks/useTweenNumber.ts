"use client";

import { useEffect, useRef, useState } from "react";

export function useTweenNumber(target: number | null, duration = 620) {
  const [displayValue, setDisplayValue] = useState(target ?? 0);
  const currentRef = useRef(target ?? 0);

  useEffect(() => {
    if (target === null) return;
    const startValue = currentRef.current;
    const delta = target - startValue;
    const startAt = performance.now();
    let frame = 0;

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const next = startValue + delta * eased;
      currentRef.current = next;
      setDisplayValue(next);
      if (progress < 1) frame = window.requestAnimationFrame(animate);
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [duration, target]);

  return target === null ? null : displayValue;
}
