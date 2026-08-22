/**
 * IP literal classification for outbound request policy.
 *
 * The only question this module answers: may a request be made to this address?
 * Loopback, unspecified, private, and link-local ranges are refused, as are the
 * IPv4-mapped IPv6 forms of them. Anything unparseable fails closed.
 */

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : -1));
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

/** Expand an IPv6 literal (including the `::ffff:1.2.3.4` form) into eight 16-bit groups. */
function parseIpv6(address: string): number[] | null {
  const bare = address.split("%")[0]!.toLowerCase();
  if (!bare.includes(":")) return null;
  const halves = bare.split("::");
  if (halves.length > 2) return null;

  const expand = (half: string): number[] | null => {
    if (half === "") return [];
    const groups: number[] = [];
    const parts = half.split(":");
    for (const [index, part] of parts.entries()) {
      if (part.includes(".")) {
        if (index !== parts.length - 1) return null;
        const octets = parseIpv4(part);
        if (!octets) return null;
        groups.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  const head = expand(halves[0]!);
  const tail = halves.length === 2 ? expand(halves[1]!) : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null;
  return [...head, ...Array<number>(fill).fill(0), ...tail];
}

function isDisallowedIpv4(octets: number[]): boolean {
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true; // unspecified / "this network"
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

/**
 * True when an IP literal is loopback, unspecified, private, link-local, or an
 * IPv4-mapped IPv6 address embedding one of those. Unparseable input fails closed.
 */
export function isDisallowedAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) return isDisallowedIpv4(ipv4);

  const groups = parseIpv6(address);
  if (!groups) return true;

  const isMapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  if (isMapped) {
    return isDisallowedIpv4([groups[6]! >> 8, groups[6]! & 0xff, groups[7]! >> 8, groups[7]! & 0xff]);
  }
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1
  if ((groups[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((groups[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}
