// QQ Mail over IMAP — list and read, credentials from dsh/home/.env.
//
//   node qqmail.mjs list 10
//   node qqmail.mjs get 1072
//
// Read-only: never marks, moves, deletes or sends.
import { readFileSync } from 'node:fs'
import { ImapFlow } from 'imapflow'

const ENV_FILE = 'D:/github_project/ZhaoWen_GitHub维护/dsh/home/.env'
const env = readFileSync(ENV_FILE, 'utf8')
const pick = (key) => (env.match(new RegExp('^\\s*' + key + '\\s*=\\s*(.+)$', 'm')) || [])[1]?.trim()

const [action = 'list', arg = '10'] = process.argv.slice(2)

const client = new ImapFlow({
  host: 'imap.qq.com',
  port: 993,
  secure: true,
  auth: { user: pick('QQMAIL_USER'), pass: pick('QQMAIL_AUTH_CODE') },
  logger: false,
})

await client.connect()
const lock = await client.getMailboxLock('INBOX')
try {
  if (action === 'list') {
    const limit = Math.max(1, Math.min(50, Number.parseInt(arg, 10) || 10))
    const rows = []
    for await (const msg of client.fetch('1:*', { uid: true, envelope: true, internalDate: true })) {
      const from = msg.envelope?.from?.[0]
      rows.push({
        uid: msg.uid,
        date: (msg.internalDate ?? new Date()).toISOString().slice(0, 16).replace('T', ' '),
        from: from ? `${from.name ?? ''} <${from.address ?? ''}>`.trim() : '',
        subject: msg.envelope?.subject ?? '',
      })
    }
    rows.sort((a, b) => b.uid - a.uid)
    console.log(JSON.stringify({ mailbox: 'INBOX', total: rows.length, items: rows.slice(0, limit) }, null, 2))
  } else if (action === 'get') {
    const uid = Number.parseInt(arg, 10)
    if (!Number.isFinite(uid)) throw new Error('usage: node qqmail.mjs get <uid>')
    const msg = await client.fetchOne(String(uid), { uid: true, envelope: true, bodyStructure: true }, { uid: true })
    if (!msg) throw new Error(`uid ${uid} not found`)
    let text = ''
    for await (const part of client.download(String(uid), undefined, { uid: true })) {
      const chunks = []
      for await (const chunk of part.content) chunks.push(chunk)
      text = Buffer.concat(chunks).toString('utf8')
    }
    const from = msg.envelope?.from?.[0]
    console.log(JSON.stringify({
      uid,
      from: from ? `${from.name ?? ''} <${from.address ?? ''}>`.trim() : '',
      subject: msg.envelope?.subject ?? '',
      date: (msg.envelope?.date ?? new Date()).toISOString(),
      text: text.slice(0, 4000),
    }, null, 2))
  } else {
    throw new Error(`unknown action: ${action}`)
  }
} finally {
  lock.release()
  await client.logout()
}
