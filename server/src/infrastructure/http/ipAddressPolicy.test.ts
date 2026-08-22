// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isDisallowedAddress } from "./ipAddressPolicy.js";

describe("isDisallowedAddress", () => {
  it("classifies loopback, unspecified, private, link-local, and IPv4-mapped addresses", () => {
    const disallowed = [
      "127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.1.1",
      "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1", "::ffff:7f00:1",
      "not-an-address",
    ];
    const allowed = ["93.184.216.34", "8.8.8.8", "172.32.0.1", "172.15.0.1", "2606:2800:220:1::1", "::ffff:93.184.216.34"];

    expect(disallowed.filter((address) => !isDisallowedAddress(address))).toEqual([]);
    expect(allowed.filter((address) => isDisallowedAddress(address))).toEqual([]);
  });
});
