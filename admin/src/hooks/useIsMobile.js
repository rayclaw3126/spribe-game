import { useEffect, useState } from 'react'
import { LAYOUT } from '../theme/tokens.js'

export default function useIsMobile(breakpoint = LAYOUT.breakpoint) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint)

  useEffect(() => {
    function onResize() {
      setIsMobile(window.innerWidth < breakpoint)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [breakpoint])

  return isMobile
}
