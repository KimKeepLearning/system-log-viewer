import { useEffect, useRef } from "react";
const resetTimeout = 2000; // 2 seconds to reset click count

export const useEasterEgg = () => {
  const clickCountRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleLogoClick = () => {
    // Clear existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    clickCountRef.current += 1;

    if (clickCountRef.current >= 3) {
      // Reset immediately
      clickCountRef.current = 0;
    } else {
      // Set new reset timer
      timerRef.current = setTimeout(() => {
        clickCountRef.current = 0;
      }, resetTimeout);
    }
  };

  return { handleLogoClick };
};
