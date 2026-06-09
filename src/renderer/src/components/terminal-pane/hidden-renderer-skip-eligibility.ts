export type HiddenRendererSkipEligibility = {
  foreground: boolean
  canRestoreHiddenOutput: boolean
  startupRendererQueryWindowActive: boolean
  synchronizedOutputActive: boolean
  data: string
}

function isAllowedPlainHiddenOutputCode(code: number): boolean {
  if (code === 0x09 || code === 0x0a) {
    return true
  }
  return code >= 0x20 && code <= 0x7e
}

function containsOnlyPlainHiddenOutput(data: string): boolean {
  for (let index = 0; index < data.length; index++) {
    const code = data.charCodeAt(index)
    if (code === 0x0d) {
      if (data.charCodeAt(index + 1) !== 0x0a) {
        return false
      }
      continue
    }
    if (!isAllowedPlainHiddenOutputCode(code)) {
      return false
    }
  }
  return true
}

export function shouldSkipHiddenRendererOutput({
  foreground,
  canRestoreHiddenOutput,
  startupRendererQueryWindowActive,
  synchronizedOutputActive,
  data
}: HiddenRendererSkipEligibility): boolean {
  if (
    foreground ||
    !canRestoreHiddenOutput ||
    startupRendererQueryWindowActive ||
    synchronizedOutputActive ||
    data.length === 0
  ) {
    return false
  }
  return containsOnlyPlainHiddenOutput(data)
}
