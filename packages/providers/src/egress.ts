export interface EgressPolicy {
  allowlist: string[];
  allowLoopback: boolean;
}

function parseHost(rawUrl: string): { host: string; protocol: string; port: string; username: string } | null {
  try {
    const url = new URL(rawUrl);
    return { host: url.hostname.toLowerCase().replace(/\.+$/, ""), protocol: url.protocol, port: url.port, username: url.username };
  } catch {
    return null;
  }
}

function ipv4Parts(host: string): number[] | null {
  if (/^\d+$/.test(host)) {
    const n = Number(host);
    if (!Number.isSafeInteger(n) || n < 0 || n > 4294967295) {
      return null;
    }
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  const segs = host.split(".");
  if (segs.length !== 4) {
    return null;
  }
  const out: number[] = [];
  for (const s of segs) {
    let v: number;
    if (/^0x[0-9a-f]+$/i.test(s)) {
      v = parseInt(s, 16);
    } else if (/^0[0-7]+$/.test(s) && s.length > 1) {
      v = parseInt(s, 8);
    } else if (/^\d+$/.test(s)) {
      v = parseInt(s, 10);
    } else {
      return null;
    }
    if (v < 0 || v > 255) {
      return null;
    }
    out.push(v);
  }
  return out;
}

function isBlockedIpv4(parts: number[]): boolean {
  const [a, b] = parts;
  if (a === 10) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  if (a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  return false;
}

function normalizedIpv6(host: string): string {
  let h = host.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (h.startsWith("::ffff:")) {
    h = h.slice(7);
  }
  return h;
}

function isBlockedIpv6(host: string): boolean {
  const h = normalizedIpv6(host);
  if (h === "::1" || h === "0:0:0:0:0:0:0:1" || h === "::" || h === "0:0:0:0:0:0:0:0") {
    return true;
  }
  if (h.startsWith("fe80:") || h.startsWith("fe80::")) {
    return true;
  }
  if (h.startsWith("fc") || h.startsWith("fd")) {
    return true;
  }
  return false;
}

function isBlockedHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }
  if (host === "metadata.google.internal" || host === "metadata.google.com") {
    return true;
  }
  const v4 = ipv4Parts(host);
  if (v4) {
    return isBlockedIpv4(v4);
  }
  if (host.includes(":")) {
    return isBlockedIpv6(host);
  }
  return false;
}

function matchesAllowlist(host: string, allowlist: string[]): boolean {
  return allowlist.some((entry) => {
    const e = entry.trim().toLowerCase().replace(/\.+$/, "");
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
  const parsed = parseHost(rawUrl);
  if (!parsed || parsed.username !== "") {
    throw new Error("egress_denied");
  }
  const { host, protocol, port } = parsed;
  if (protocol !== "https:") {
    if (!(policy.allowLoopback && protocol === "http:" && (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1"))) {
      throw new Error("egress_denied");
    }
  }
  if (port !== "" && !(policy.allowLoopback && (host === "localhost" || host.endsWith(".localhost")))) {
    throw new Error("egress_denied");
  }
  if (isBlockedHost(host)) {
    if (!(policy.allowLoopback && (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1"))) {
      throw new Error("egress_denied");
    }
  }
  if (!matchesAllowlist(host, policy.allowlist) && !(policy.allowLoopback && host === "localhost")) {
    throw new Error("egress_denied");
  }
}

export function assertWebhookUrl(rawUrl: string, allowPrivate: boolean): void {
  const parsed = parseHost(rawUrl);
  if (!parsed || parsed.username !== "") {
    throw new Error("webhook_denied");
  }
  const { host, protocol } = parsed;
  if (protocol !== "https:") {
    const loopbackHttp = allowPrivate && protocol === "http:" && (host === "localhost" || host.endsWith(".localhost"));
    if (!loopbackHttp) {
      throw new Error("webhook_denied");
    }
  }
  if (!allowPrivate && isBlockedHost(host)) {
    throw new Error("webhook_denied");
  }
}
