import { describe, expect, it } from 'vitest'
import type { NetworkInterfaceInfo } from 'os'
import { pickLanAddress } from './lanAddress'

function v4(address: string, internal = false): NetworkInterfaceInfo {
  return {
    address,
    netmask: '255.255.255.0',
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal,
    cidr: `${address}/24`
  }
}

describe('pickLanAddress', () => {
  it('picks the Wi-Fi address on a typical Mac', () => {
    expect(
      pickLanAddress({
        lo0: [v4('127.0.0.1', true)],
        en0: [v4('192.168.1.42')],
        utun3: [v4('10.8.0.2')],
        awdl0: [v4('169.254.10.1')]
      })
    ).toEqual({ address: '192.168.1.42', interfaceName: 'en0' })
  })

  it('skips VPN, container and VM interfaces even with private addresses', () => {
    expect(
      pickLanAddress({
        docker0: [v4('172.17.0.1')],
        vmnet8: [v4('192.168.56.1')],
        tailscale0: [v4('100.101.1.2')],
        eth0: [v4('10.0.0.15')]
      })
    ).toEqual({ address: '10.0.0.15', interfaceName: 'eth0' })
  })

  it('prefers a private address over a public one', () => {
    expect(
      pickLanAddress({ en1: [v4('203.0.113.9')], en0: [v4('192.168.0.8')] })?.address
    ).toBe('192.168.0.8')
  })

  it('returns null when only loopback and link-local are up (no network)', () => {
    expect(pickLanAddress({ lo0: [v4('127.0.0.1', true)], en0: [v4('169.254.3.4')] })).toBeNull()
  })

  it('ignores IPv6 entries', () => {
    expect(
      pickLanAddress({
        en0: [{ ...v4('fe80::1'), family: 'IPv6', scopeid: 1 } as NetworkInterfaceInfo]
      })
    ).toBeNull()
  })
})
