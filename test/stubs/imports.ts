// Stand-in for the Nitro auto-imports used by the tested utils
export const runtimeConfig: Record<string, any> = {}

export function useRuntimeConfig() {
  return runtimeConfig
}

export function createError(input: { statusCode: number, message: string }) {
  return Object.assign(new Error(input.message), { statusCode: input.statusCode })
}
