import * as React from "react"

const MOBILE_BREAKPOINT = 768
const LG_BREAKPOINT = 1024

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

export function useIsLg() {
  const [isLg, setIsLg] = React.useState<boolean>(() =>
    typeof window !== "undefined" &&
    window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`).matches,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`)
    const onChange = () => setIsLg(mql.matches)
    mql.addEventListener("change", onChange)
    setIsLg(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isLg
}
