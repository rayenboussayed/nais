/**
 * Maps the TRUST_PROXY env enum onto Fastify's `trustProxy` option.
 * 'loopback' trusts only same-host reverse proxies (nginx/caddy on one box);
 * 'true' trusts any forwarded-for chain (multi-tier LB, e2e tests, k8s ingress
 * with trusted CIDRs is the operator's responsibility); 'false' ignores
 * forwarded headers entirely.
 * @param value - the TRUST_PROXY env enum value
 * @returns Fastify's `trustProxy` option
 */
export function resolveTrustProxy(value: 'false' | 'loopback' | 'true'): 'loopback' | boolean {
  switch (value) {
    case 'false':
      return false;
    case 'loopback':
      return 'loopback';
    case 'true':
      return true;
  }
}
