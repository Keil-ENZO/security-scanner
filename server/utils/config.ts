const list = (value: string) =>
  value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

export function scannerConfig() {
  const config = useRuntimeConfig()
  return {
    ...config,
    owners: list(config.allowedOwners),
    hosts: list(config.allowedHosts),
  }
}
