/** Protocol fixture: no Tailscale network, keys or desktop installation is contacted. */
import { createInterface } from 'node:readline'
import { writeFileSync } from 'node:fs'

const [mode, capture] = process.argv.slice(2)
const send = event => process.stdout.write(JSON.stringify({ version: 1, ...event }) + '\n')
let configured = false
const input = createInterface({ input: process.stdin })
input.on('line', line => {
  const value = JSON.parse(line)
  if (!configured) {
    configured = true
    writeFileSync(capture, JSON.stringify({ config: value, pid: process.pid,
      inheritedAuthKey: process.env.TS_AUTHKEY, inheritedModelKey: process.env.DEEPSEEK_API_KEY }))
    if (mode === 'malformed') { process.stdout.write('not JSON\n'); return }
    send({ state: 'proxy-ready', proxyURL: 'http://127.0.0.1:54321' })
    send({ state: 'needs-login', loginURL: mode === 'bad-login' ? 'https://attacker.invalid/login' : 'https://login.tailscale.com/a/fixture' })
    if (mode === 'online') send({ state: 'online', url: 'http://100.64.0.2/' })
    return
  }
  send({ state: 'published', revision: value.revision })
})
input.on('close', () => { process.exit(0) })
