import type { StackContract, StackStep, Tool } from './contracts'

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const MAX_KEYS = 40

/**
 * Keep a stack contract aligned with the members that still exist.
 * Returns undefined when there is nothing to remember, so old collections
 * stay byte-for-byte free of the field.
 */
export function normalizeStack(
  stack: StackContract | undefined,
  toolIds: readonly string[],
): StackContract | undefined {
  if (!stack || typeof stack !== 'object') return undefined
  const allowed = new Set(toolIds)
  const steps: StackStep[] = []
  for (const step of Array.isArray(stack.steps) ? stack.steps : []) {
    if (!step || !allowed.has(step.toolId)) continue
    const requireEnvKeys = Array.from(
      new Set(
        (Array.isArray(step.requireEnvKeys) ? step.requireEnvKeys : []).filter(
          (key) => typeof key === 'string' && ENV_KEY.test(key),
        ),
      ),
    ).slice(0, MAX_KEYS)
    if (requireEnvKeys.length === 0) continue
    steps.push({ toolId: step.toolId, requireEnvKeys })
  }
  const ordered = stack.ordered === true
  if (!ordered && steps.length === 0) return undefined
  return { ordered, steps }
}

/** Parse a comma-separated field into env key names. Drops anything that is not a name. */
export function parseEnvKeyList(text: string): string[] {
  return Array.from(
    new Set(
      text
        .split(/[\s,]+/)
        .map((key) => key.trim())
        .filter((key) => ENV_KEY.test(key)),
    ),
  ).slice(0, MAX_KEYS)
}

/**
 * Key names required by the contract that the tool does not have a non-empty
 * value for. The values themselves are never returned.
 */
export function missingEnvKeys(tool: Tool, keys: readonly string[] | undefined): string[] {
  if (!keys || keys.length === 0) return []
  return keys.filter((key) => !tool.env?.[key]?.trim())
}
