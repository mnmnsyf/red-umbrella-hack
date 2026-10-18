export function isExternal(): boolean {
  return new URLSearchParams(window.location.search).has('external');
}
