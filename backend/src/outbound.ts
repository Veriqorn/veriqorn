import { lookup } from "dns/promises";

import { HttpError } from "./errors";

const normalizeHost = (value: string): string => value.trim().toLowerCase().replace(/^\[|\]$/g, "");

const isPrivateAddress = (address: string): boolean => {
  const value = address.toLowerCase();
  const mappedIpv4 = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateAddress(mappedIpv4);
  if (value === "::1" || value === "::" || value === "0:0:0:0:0:0:0:1" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 100 && b >= 64 && b <= 127 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a >= 224;
};

export const parsePrivateOutboundOrigins = (raw = ""): string[] => raw.split(",").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
  let url: URL;
  try { url = new URL(entry); } catch { throw new Error("OUTBOUND_PRIVATE_ALLOWED_ORIGINS must contain exact HTTP(S) origins"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*")) {
    throw new Error("OUTBOUND_PRIVATE_ALLOWED_ORIGINS must contain exact HTTP(S) origins without paths or credentials");
  }
  return url.origin;
});

export const assertSafeOutboundUrl = async (rawUrl: string, allowedHosts: string[], privateAllowedOrigins: string[] = []): Promise<URL> => {
  let url: URL;
  try { url = new URL(rawUrl); } catch {
    throw new HttpError(400, "OUTBOUND_URL_INVALID", "Outbound URL must be a valid HTTP(S) URL");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new HttpError(400, "OUTBOUND_URL_INVALID", "Outbound URL must use HTTP(S) without embedded credentials");
  }
  const host = normalizeHost(url.hostname);
  const allowed = allowedHosts.some((entry) => {
    const candidate = normalizeHost(entry);
    return candidate === host || (candidate.startsWith("*.") && host.endsWith(candidate.slice(1)));
  });
  if (!allowed) throw new HttpError(403, "OUTBOUND_HOST_NOT_ALLOWED", "Outbound host is not allowlisted");
  try {
    const addresses = await lookup(host, { all: true, verbatim: true });
    if (addresses.length === 0 || (!privateAllowedOrigins.includes(url.origin) && addresses.some(({ address }) => isPrivateAddress(address)))) {
      throw new HttpError(403, "OUTBOUND_ADDRESS_NOT_ALLOWED", "Outbound host resolves to a private or reserved address");
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "OUTBOUND_HOST_UNRESOLVABLE", "Outbound host cannot be resolved");
  }
  return url;
};
