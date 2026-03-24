import { describe, it, expect } from "bun:test"
import {
  normalizeHostnameSuffix,
  normalizeHostnameSuffixAllowlist,
  isHostnameAllowedBySuffixAllowlist,
  isHttpsUrlAllowedByHostnameSuffixAllowlist,
  buildHostnameAllowlistPolicyFromSuffixAllowlist,
  createSafeFetch,
  SSRFBlockedError,
  isPrivateIpAddress,
} from "./ssrf-policy"

describe("normalizeHostnameSuffix", () => {
  it("normalizes hostname to lowercase", () => {
    expect(normalizeHostnameSuffix("EXAMPLE.COM")).toBe("example.com")
  })

  it("removes leading wildcards", () => {
    expect(normalizeHostnameSuffix("*.example.com")).toBe("example.com")
    expect(normalizeHostnameSuffix("*..example.com")).toBe("example.com")
  })

  it("removes leading dots", () => {
    expect(normalizeHostnameSuffix(".example.com")).toBe("example.com")
  })

  it("removes trailing dots", () => {
    expect(normalizeHostnameSuffix("example.com.")).toBe("example.com")
  })

  it("handles wildcard-only input", () => {
    expect(normalizeHostnameSuffix("*")).toBe("*")
    expect(normalizeHostnameSuffix("*.")).toBe("*")
  })

  it("returns empty string for invalid input", () => {
    expect(normalizeHostnameSuffix("")).toBe("")
    expect(normalizeHostnameSuffix("   ")).toBe("")
  })
})

describe("normalizeHostnameSuffixAllowlist", () => {
  it("uses defaults when input is missing", () => {
    expect(normalizeHostnameSuffixAllowlist(undefined, ["GRAPH.MICROSOFT.COM"])).toEqual([
      "graph.microsoft.com",
    ])
  })

  it("normalizes and deduplicates entries", () => {
    expect(
      normalizeHostnameSuffixAllowlist([
        "*.TrafficManager.NET",
        ".trafficmanager.net.",
        "x",
        "X",
      ]),
    ).toEqual(["trafficmanager.net", "x"])
  })

  it("returns wildcard-only if wildcard present", () => {
    expect(normalizeHostnameSuffixAllowlist(["example.com", "*"])).toEqual(["*"])
  })

  it("returns empty array for empty input", () => {
    expect(normalizeHostnameSuffixAllowlist()).toEqual([])
    expect(normalizeHostnameSuffixAllowlist([])).toEqual([])
  })
})

describe("isHostnameAllowedBySuffixAllowlist", () => {
  it("allows all with wildcard", () => {
    expect(isHostnameAllowedBySuffixAllowlist("evil.com", ["*"])).toBe(true)
  })

  it("matches exact hostname", () => {
    expect(isHostnameAllowedBySuffixAllowlist("example.com", ["example.com"])).toBe(true)
  })

  it("matches subdomain suffix", () => {
    expect(isHostnameAllowedBySuffixAllowlist("api.example.com", ["example.com"])).toBe(true)
    expect(isHostnameAllowedBySuffixAllowlist("sub.api.example.com", ["example.com"])).toBe(true)
  })

  it("rejects non-matching hostname", () => {
    expect(isHostnameAllowedBySuffixAllowlist("evil.com", ["example.com"])).toBe(false)
  })

  it("is case insensitive", () => {
    expect(isHostnameAllowedBySuffixAllowlist("API.EXAMPLE.COM", ["example.com"])).toBe(true)
  })

  it("requires proper suffix boundary", () => {
    // notexample.com should not match example.com
    expect(isHostnameAllowedBySuffixAllowlist("notexample.com", ["example.com"])).toBe(false)
  })
})

describe("isHttpsUrlAllowedByHostnameSuffixAllowlist", () => {
  it("requires HTTPS protocol", () => {
    expect(
      isHttpsUrlAllowedByHostnameSuffixAllowlist("http://api.example.com/path", ["example.com"]),
    ).toBe(false)
  })

  it("accepts valid HTTPS URL with matching hostname", () => {
    expect(
      isHttpsUrlAllowedByHostnameSuffixAllowlist("https://api.anthropic.com/v1/messages", [
        "anthropic.com",
      ]),
    ).toBe(true)
  })

  it("accepts subdomain matches", () => {
    expect(
      isHttpsUrlAllowedByHostnameSuffixAllowlist("https://api.example.com/path", ["example.com"]),
    ).toBe(true)
  })

  it("rejects non-matching hostname", () => {
    expect(
      isHttpsUrlAllowedByHostnameSuffixAllowlist("https://evil.com/attack", ["example.com"]),
    ).toBe(false)
  })

  it("returns false for invalid URL", () => {
    expect(
      isHttpsUrlAllowedByHostnameSuffixAllowlist("not-a-valid-url", ["example.com"]),
    ).toBe(false)
  })

  it("allows all with wildcard", () => {
    expect(
      isHttpsUrlAllowedByHostnameSuffixAllowlist("https://any-domain.com/path", ["*"]),
    ).toBe(true)
  })
})

describe("buildHostnameAllowlistPolicyFromSuffixAllowlist", () => {
  it("returns undefined for empty input", () => {
    expect(buildHostnameAllowlistPolicyFromSuffixAllowlist()).toBeUndefined()
    expect(buildHostnameAllowlistPolicyFromSuffixAllowlist([])).toBeUndefined()
  })

  it("returns undefined for wildcard allowlist", () => {
    expect(buildHostnameAllowlistPolicyFromSuffixAllowlist(["*"])).toBeUndefined()
    expect(buildHostnameAllowlistPolicyFromSuffixAllowlist(["example.com", "*"])).toBeUndefined()
  })

  it("expands single hostname to exact + wildcard patterns", () => {
    expect(buildHostnameAllowlistPolicyFromSuffixAllowlist(["sharepoint.com"])).toEqual({
      hostnameAllowlist: ["sharepoint.com", "*.sharepoint.com"],
    })
  })

  it("expands multiple hostnames", () => {
    const result = buildHostnameAllowlistPolicyFromSuffixAllowlist([
      "api.anthropic.com",
      "api.openai.com",
    ])
    expect(result).toEqual({
      hostnameAllowlist: expect.arrayContaining([
        "api.anthropic.com",
        "*.api.anthropic.com",
        "api.openai.com",
        "*.api.openai.com",
      ]),
    })
  })

  it("normalizes and deduplicates patterns", () => {
    const result = buildHostnameAllowlistPolicyFromSuffixAllowlist([
      "*.TrafficManager.NET",
      ".trafficmanager.net.",
      "blob.core.windows.net",
    ])
    expect(result).toEqual({
      hostnameAllowlist: expect.arrayContaining([
        "trafficmanager.net",
        "*.trafficmanager.net",
        "blob.core.windows.net",
        "*.blob.core.windows.net",
      ]),
    })
  })
})

describe("createSafeFetch", () => {
  it("creates a fetch wrapper that validates URLs", async () => {
    const mockFetch = () => Promise.resolve(new Response("ok"))
    const safeFetch = createSafeFetch({
      allowedHosts: ["api.example.com"],
      fetchFn: mockFetch as typeof fetch,
    })

    const response = await safeFetch("https://api.example.com/path")
    expect(await response.text()).toBe("ok")
  })

  it("blocks non-HTTPS URLs by default", async () => {
    const safeFetch = createSafeFetch({
      allowedHosts: ["api.example.com"],
    })

    await expect(safeFetch("http://api.example.com/path")).rejects.toThrow(SSRFBlockedError)
  })

  it("blocks hostnames not in allowlist", async () => {
    const safeFetch = createSafeFetch({
      allowedHosts: ["api.example.com"],
    })

    await expect(safeFetch("https://evil.com/path")).rejects.toThrow(SSRFBlockedError)
  })

  it("blocks private IP addresses by default", async () => {
    const safeFetch = createSafeFetch({
      allowedHosts: ["*"], // Allow any hostname
      blockPrivateNetwork: true,
    })

    await expect(safeFetch("https://127.0.0.1/path")).rejects.toThrow(SSRFBlockedError)
    await expect(safeFetch("https://192.168.1.1/path")).rejects.toThrow(SSRFBlockedError)
    await expect(safeFetch("https://10.0.0.1/path")).rejects.toThrow(SSRFBlockedError)
  })

  it("allows private IPs when blockPrivateNetwork is false", async () => {
    const mockFetch = () => Promise.resolve(new Response("ok"))
    const safeFetch = createSafeFetch({
      allowedHosts: ["*"],
      blockPrivateNetwork: false,
      fetchFn: mockFetch as typeof fetch,
    })

    const response = await safeFetch("https://127.0.0.1/path")
    expect(await response.text()).toBe("ok")
  })

  it("throws SSRFBlockedError with details", async () => {
    const safeFetch = createSafeFetch({
      allowedHosts: ["api.example.com"],
    })

    try {
      await safeFetch("http://evil.com/path")
      expect.fail("Should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(SSRFBlockedError)
      expect(err.url).toBe("http://evil.com/path")
    }
  })
})

describe("isPrivateIpAddress", () => {
  it("identifies loopback addresses", () => {
    expect(isPrivateIpAddress("127.0.0.1")).toBe(true)
    expect(isPrivateIpAddress("127.255.255.255")).toBe(true)
    expect(isPrivateIpAddress("::1")).toBe(true)
  })

  it("identifies private network addresses", () => {
    // 10.0.0.0/8
    expect(isPrivateIpAddress("10.0.0.1")).toBe(true)
    expect(isPrivateIpAddress("10.255.255.255")).toBe(true)

    // 172.16.0.0/12
    expect(isPrivateIpAddress("172.16.0.1")).toBe(true)
    expect(isPrivateIpAddress("172.31.255.255")).toBe(true)
    expect(isPrivateIpAddress("172.15.0.1")).toBe(false)
    expect(isPrivateIpAddress("172.32.0.1")).toBe(false)

    // 192.168.0.0/16
    expect(isPrivateIpAddress("192.168.0.1")).toBe(true)
    expect(isPrivateIpAddress("192.168.255.255")).toBe(true)
  })

  it("identifies link-local addresses", () => {
    // 169.254.0.0/16
    expect(isPrivateIpAddress("169.254.0.1")).toBe(true)
    expect(isPrivateIpAddress("169.254.169.254")).toBe(true) // Cloud metadata
  })

  it("identifies unspecified addresses", () => {
    expect(isPrivateIpAddress("0.0.0.0")).toBe(true)
    expect(isPrivateIpAddress("::")).toBe(true)
  })

  it("identifies localhost hostname", () => {
    expect(isPrivateIpAddress("localhost")).toBe(true)
    expect(isPrivateIpAddress("localhost.localdomain")).toBe(true)
  })

  it("handles IPv6 with brackets", () => {
    expect(isPrivateIpAddress("[::1]")).toBe(true)
    expect(isPrivateIpAddress("[fe80::1]")).toBe(true)
  })

  it("identifies IPv4-mapped IPv6 addresses", () => {
    expect(isPrivateIpAddress("::ffff:127.0.0.1")).toBe(true)
    expect(isPrivateIpAddress("::ffff:192.168.1.1")).toBe(true)
  })

  it("allows public addresses", () => {
    expect(isPrivateIpAddress("8.8.8.8")).toBe(false)
    expect(isPrivateIpAddress("1.1.1.1")).toBe(false)
    expect(isPrivateIpAddress("api.example.com")).toBe(false)
  })

  it("blocks documentation and benchmark ranges", () => {
    // TEST-NET-1: 192.0.2.0/24
    expect(isPrivateIpAddress("192.0.2.1")).toBe(true)

    // TEST-NET-2: 198.51.100.0/24
    expect(isPrivateIpAddress("198.51.100.1")).toBe(true)

    // TEST-NET-3: 203.0.113.0/24
    expect(isPrivateIpAddress("203.0.113.1")).toBe(true)

    // RFC2544 benchmark: 198.18.0.0/15
    expect(isPrivateIpAddress("198.18.0.1")).toBe(true)
    expect(isPrivateIpAddress("198.19.255.255")).toBe(true)
  })

  it("blocks multicast and reserved ranges", () => {
    // Multicast: 224.0.0.0/4
    expect(isPrivateIpAddress("224.0.0.1")).toBe(true)
    expect(isPrivateIpAddress("239.255.255.255")).toBe(true)

    // Reserved: 240.0.0.0/4
    expect(isPrivateIpAddress("240.0.0.1")).toBe(true)
    expect(isPrivateIpAddress("255.255.255.255")).toBe(true)
  })

  it("blocks carrier-grade NAT", () => {
    // 100.64.0.0/10
    expect(isPrivateIpAddress("100.64.0.1")).toBe(true)
    expect(isPrivateIpAddress("100.127.255.255")).toBe(true)
    expect(isPrivateIpAddress("100.63.0.1")).toBe(false)
    expect(isPrivateIpAddress("100.128.0.1")).toBe(false)
  })

  it("handles IPv6 private ranges", () => {
    // Unique local: fc00::/7
    expect(isPrivateIpAddress("fc00::1")).toBe(true)
    expect(isPrivateIpAddress("fd00::1")).toBe(true)

    // Link-local: fe80::/10
    expect(isPrivateIpAddress("fe80::1")).toBe(true)
  })

  it("fails closed for unknown formats", () => {
    // Unknown format should be blocked
    expect(isPrivateIpAddress("not-an-ip")).toBe(true)
  })
})
