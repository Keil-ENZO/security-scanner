import { useRuntimeConfig } from '#imports'

const list = (value: string) =>
  value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

export function scannerConfig(): { owners: string[], hosts: string[] } {
  const config = useRuntimeConfig()
  return {
    owners: list(config.allowedOwners),
    hosts: list(config.allowedHosts),
  }
}
