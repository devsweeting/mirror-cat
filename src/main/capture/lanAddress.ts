import type { NetworkInterfaceInfo } from 'os'

export interface LanAddress {
  address: string
  interfaceName: string
}

/** Interfaces a phone on the home Wi-Fi can't reach: VPNs, VMs, containers, Apple peer links. */
const SKIP_INTERFACE = /^(lo|utun|tun|tap|ipsec|ppp|docker|br-|veth|vboxnet|vmnet|virbr|bridge|awdl|llw|anpi|ap\d|zt|tailscale|wg)/i
/** Wired and Wi-Fi names on macOS, Linux and Windows. */
const PREFER_INTERFACE = /^(en\d|eth\d|wlan\d|wlp|enp|eno|wi-?fi|ethernet)/i

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

/**
 * The address a phone on the same Wi-Fi should use to reach this computer:
 * an IPv4 address on a real Wi-Fi / Ethernet interface, preferring private
 * (home-network) ranges. Link-local (169.254.x) addresses mean "no network"
 * and are skipped. Returns null when nothing suitable is up.
 */
export function pickLanAddress(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>
): LanAddress | null {
  const candidates: (LanAddress & { score: number })[] = []
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries || SKIP_INTERFACE.test(name)) continue
    for (const entry of entries) {
      const family = entry.family as string | number
      if (entry.internal || (family !== 'IPv4' && family !== 4)) continue
      if (entry.address.startsWith('169.254.')) continue
      const score = (isPrivateIPv4(entry.address) ? 2 : 0) + (PREFER_INTERFACE.test(name) ? 1 : 0)
      candidates.push({ address: entry.address, interfaceName: name, score })
    }
  }
  candidates.sort((x, y) => y.score - x.score)
  const best = candidates[0]
  return best ? { address: best.address, interfaceName: best.interfaceName } : null
}
