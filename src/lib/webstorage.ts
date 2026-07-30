// NOTE: every function here is injected into the page with
// chrome.scripting.executeScript({ func }). Each must be self-contained:
// no imports, no closure over module variables.

export function readStoragesInPage(): {
  localStorage: Record<string, string>
  sessionStorage: Record<string, string>
} {
  const dump = (s: Storage) => {
    const out: Record<string, string> = {}
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)!
      out[k] = s.getItem(k)!
    }
    return out
  }
  return {
    localStorage: dump(window.localStorage),
    sessionStorage: dump(window.sessionStorage),
  }
}

export function clearStoragesInPage(): void {
  window.localStorage.clear()
  window.sessionStorage.clear()
}

export function writeStoragesInPage(
  ls: Record<string, string>,
  ss: Record<string, string>
): void {
  window.localStorage.clear()
  window.sessionStorage.clear()
  for (const [k, v] of Object.entries(ls)) window.localStorage.setItem(k, v)
  for (const [k, v] of Object.entries(ss)) window.sessionStorage.setItem(k, v)
}
