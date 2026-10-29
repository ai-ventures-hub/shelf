/**
 * The Companion server's self-signed certificate, generated once per Mac into
 * `<dataRoot>/companion/`. Node cannot mint certificates itself, so this
 * shells out to the system `openssl` (LibreSSL on macOS) with a config file
 * rather than `-addext`, which older LibreSSL builds lack.
 *
 * The SHA-256 fingerprint rides in the pairing QR so the phone can confirm
 * it is talking to this Mac; Settings can also save the certificate so the
 * user installs and trusts it on the phone.
 */
import { X509Certificate } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { companionDir } from './companion-store'

export interface CompanionCertificate {
  keyPath: string
  certPath: string
  key: string
  cert: string
  /** SHA-256 fingerprint, lowercase hex without colons. */
  fingerprint: string
  /** Fingerprint grouped for reading aloud: AB:CD:… */
  fingerprintDisplay: string
}

/**
 * iOS (13+) refuses TLS server certificates valid for more than 825 days,
 * and its Certificate Trust Settings only list certificates that are
 * authorities, so a self-signed server certificate must be both short-lived
 * and CA:TRUE to ever be trusted on a phone.
 */
const CERT_DAYS = 800
const IOS_MAX_DAYS = 825

export function fingerprintOf(certPem: string): string {
  return new X509Certificate(certPem).fingerprint256.replace(/:/g, '').toLowerCase()
}

export function displayFingerprint(hex: string): string {
  return (hex.match(/.{1,2}/g) || []).join(':').toUpperCase()
}

/**
 * Load the certificate, generating it on first use. `sanAddresses` are the
 * IPv4 addresses baked into subjectAltName at generation time only; an
 * existing certificate is never regenerated (that would invalidate what a
 * phone already trusts).
 */
export function ensureCompanionCertificate(
  root: string,
  sanAddresses: string[],
  opensslPath = '/usr/bin/openssl',
): CompanionCertificate {
  const dir = companionDir(root)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const keyPath = path.join(dir, 'companion-key.pem')
  const certPath = path.join(dir, 'companion-cert.pem')

  if (!fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    generate(keyPath, certPath, sanAddresses, opensslPath)
  }
  const key = fs.readFileSync(keyPath, 'utf8')
  const cert = fs.readFileSync(certPath, 'utf8')
  let fingerprint: string
  let reason: string | null
  try {
    fingerprint = fingerprintOf(cert)
    reason = certificateProblem(cert)
  } catch {
    fingerprint = ''
    reason = 'unreadable'
  }
  if (reason) {
    // Set the old pair aside (a phone may still trust it) and mint one iOS accepts.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.renameSync(certPath, `${certPath}.${reason}-${stamp}`)
    if (fs.existsSync(keyPath)) fs.renameSync(keyPath, `${keyPath}.${reason}-${stamp}`)
    generate(keyPath, certPath, sanAddresses, opensslPath)
    return ensureCompanionCertificate(root, sanAddresses, opensslPath)
  }
  return { keyPath, certPath, key, cert, fingerprint, fingerprintDisplay: displayFingerprint(fingerprint) }
}

/** Why a stored certificate must be replaced, or null when a phone can trust it. */
export function certificateProblem(certPem: string): string | null {
  const parsed = new X509Certificate(certPem)
  const days = (Date.parse(parsed.validTo) - Date.parse(parsed.validFrom)) / 86_400_000
  if (days > IOS_MAX_DAYS) return 'too-long'
  if (!parsed.ca) return 'not-ca'
  if (Date.parse(parsed.validTo) < Date.now() + 7 * 86_400_000) return 'expiring'
  return null
}

function generate(keyPath: string, certPath: string, sanAddresses: string[], opensslPath: string): void {
  const alt = ['DNS.1 = shelf.local', 'DNS.2 = localhost', 'IP.1 = 127.0.0.1']
  let n = 2
  for (const address of sanAddresses) {
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address) && address !== '127.0.0.1') alt.push(`IP.${n++} = ${address}`)
  }
  const config = [
    '[req]',
    'distinguished_name = dn',
    'x509_extensions = v3',
    'prompt = no',
    '[dn]',
    'CN = Shelf Companion',
    'O = Shelf',
    '[v3]',
    // CA:TRUE on a self-signed server certificate is what lets iOS list it
    // under Certificate Trust Settings; keyCertSign goes with it.
    'basicConstraints = critical, CA:TRUE',
    'keyUsage = critical, digitalSignature, keyEncipherment, keyCertSign',
    'extendedKeyUsage = serverAuth',
    'subjectKeyIdentifier = hash',
    'subjectAltName = @alt',
    '[alt]',
    ...alt,
    '',
  ].join('\n')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-companion-cert-'))
  const configPath = path.join(tmp, 'openssl.cnf')
  try {
    fs.writeFileSync(configPath, config, { mode: 0o600 })
    execFileSync(opensslPath, [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256',
      '-days', String(CERT_DAYS),
      '-keyout', keyPath,
      '-out', certPath,
      '-config', configPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] })
    fs.chmodSync(keyPath, 0o600)
    fs.chmodSync(certPath, 0o644)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not create the Companion certificate with ${opensslPath}: ${detail}`)
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
