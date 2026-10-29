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

const CERT_DAYS = 3650

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
  try {
    fingerprint = fingerprintOf(cert)
  } catch {
    // Unreadable material: set it aside and mint a fresh pair.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    fs.renameSync(certPath, `${certPath}.corrupt-${stamp}`)
    if (fs.existsSync(keyPath)) fs.renameSync(keyPath, `${keyPath}.corrupt-${stamp}`)
    generate(keyPath, certPath, sanAddresses, opensslPath)
    return ensureCompanionCertificate(root, sanAddresses, opensslPath)
  }
  return { keyPath, certPath, key, cert, fingerprint, fingerprintDisplay: displayFingerprint(fingerprint) }
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
    'basicConstraints = CA:FALSE',
    'keyUsage = digitalSignature, keyEncipherment',
    'extendedKeyUsage = serverAuth',
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
