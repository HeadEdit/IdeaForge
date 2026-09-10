import { useEffect, useState } from 'react';

export const MOBILE_WORKBENCH_QUERY = '(max-width: 1023px)';

export function useMobileWorkbench(): boolean {
  const getMatches = () => (
    typeof window !== 'undefined'
      && (window.matchMedia?.(MOBILE_WORKBENCH_QUERY).matches ?? window.innerWidth < 1024)
  );
  const [mobile, setMobile] = useState(getMatches);

  useEffect(() => {
    const media = window.matchMedia?.(MOBILE_WORKBENCH_QUERY);
    if (!media) {
      const handleResize = () => setMobile(window.innerWidth < 1024);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
    const handleChange = (event: MediaQueryListEvent) => setMobile(event.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  return mobile;
}
