export interface EgressPolicy {
  allowlist: string[];
  allowLoopback: boolean;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopback(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".localhost");
}

function isLinkLocal(host: string): boolean {
  return host === "169.254.169.254" || host.startsWith("169.254.") || host === "metadata.google.internal";
}

function matchesAllowlist(host: string, allowlist: string[]): boolean {
  return allowlist.some((entry) => {
    const e = entry.trim().toLowerCase();
    if (e === "") {
      return false;
    }
    if (e.startsWith("*.")) {
      return host === e.slice(2) || host.endsWith(e.slice(1));
    }
    return host === e;
  });
}

export function assertEgressAllowed(rawUrl: string, policy: EgressPolicy): void {
  const host = hostOf(rawUrl);
  if (!host) {
    throw new Error("egress_denied");
  }
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && !(policy.allowLoopback && url.protocol === "http:" && isLoopback(host))) {
    throw new Error("egress_denied");
  }
  if (isLinkLocal(host)) {
    throw new Error("egress_denied");
  }
  if (isLoopback(host) && !policy.allowLoopback) {
    throw new Error("egress_denied");
  }
  if (!matchesAllowlist(host, policy.allowlist)) {
    throw new Error("egress_denied");
  }
}
