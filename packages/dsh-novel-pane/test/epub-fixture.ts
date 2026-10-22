// 测试用的极小 EPUB：用 node 的 zlib 现造一个 ZIP。
//
// 不引依赖——测试要证明的正是「宿主自己读 ZIP」这件事，所以压缩包也得自己拼。

import { deflateRawSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)

  for (let index = 0; index < 256; index += 1) {
    let value = index

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }

    table[index] = value
  }

  return table
})()

const crc32 = (buffer: Buffer): number => {
  let value = 0xffffffff

  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)

  return (value ^ 0xffffffff) >>> 0
}

export interface ZipEntryInput {
  /** ZIP 里的路径（UTF-8）。 */
  name: string
  data: string | Buffer
  /** 缺省 deflate；mimetype 按规范用 store。 */
  method?: 'store' | 'deflate'
}

/** 拼一个合法的 ZIP；本地头 + 中央目录 + EOCD。 */
export const buildZip = (entries: readonly ZipEntryInput[]): Buffer => {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const store = entry.method === 'store'
    const body = store ? data : deflateRawSync(data)
    const method = store ? 0 : 8
    const crc = crc32(data)
    const local = Buffer.alloc(30)

    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // 需要 2.0
    local.writeUInt16LE(0x0800, 6) // 文件名是 UTF-8
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10) // 时间
    local.writeUInt16LE(0x21, 12) // 1980-01-01
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    locals.push(local, name, body)

    const central = Buffer.alloc(46)

    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // made by
    central.writeUInt16LE(20, 6) // needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)

    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }

  const directory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)

  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, directory, eocd])
}

export const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

/**
 * manifest 故意把第二章写在前面；spine 才是顺序的依据（c1 → c2）。
 * 第一章的文件名用中文，顺便测 ZIP 文件名解码。
 */
export const CONTENT_OPF = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">测试书</dc:title></metadata>
  <manifest>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
    <item id="c1" href="第一章.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>
`

export const CHAPTER_ONE = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>不该出现的标题</title><style>p { color: red }</style></head>
  <body>
    <h1>第一章 夜航</h1>
    <p>船在雾里走 &amp; 灯是唯一的方向。</p>
    <p>第二段：没有标签。</p>
  </body>
</html>
`

export const CHAPTER_TWO = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <body><h2>第二章 灯塔</h2><p>尾声。</p></body>
</html>
`

/** 一本能读的极小 EPUB。 */
export const minimalEpub = (): Buffer =>
  buildZip([
    { name: 'mimetype', data: 'application/epub+zip', method: 'store' },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'OEBPS/content.opf', data: CONTENT_OPF },
    { name: 'OEBPS/第一章.xhtml', data: CHAPTER_ONE },
    { name: 'OEBPS/chapter2.xhtml', data: CHAPTER_TWO },
    { name: 'OEBPS/style.css', data: 'p { color: red }' },
  ])

/** 带 DRM 清单（加密的正是正文）的 EPUB。 */
export const encryptedEpub = (): Buffer =>
  buildZip([
    { name: 'mimetype', data: 'application/epub+zip', method: 'store' },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    {
      name: 'META-INF/encryption.xml',
      data: `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData><CipherData><CipherReference URI="OEBPS/第一章.xhtml"/></CipherData></EncryptedData>
</encryption>`,
    },
    { name: 'OEBPS/content.opf', data: CONTENT_OPF },
    { name: 'OEBPS/第一章.xhtml', data: CHAPTER_ONE },
    { name: 'OEBPS/chapter2.xhtml', data: CHAPTER_TWO },
  ])

/** 只有字体被混淆（正常 EPUB 常见）——不该被当成 DRM 拒绝。 */
export const fontObfuscatedEpub = (): Buffer =>
  buildZip([
    { name: 'mimetype', data: 'application/epub+zip', method: 'store' },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    {
      name: 'META-INF/encryption.xml',
      data: `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData><CipherData><CipherReference URI="OEBPS/fonts/main.ttf"/></CipherData></EncryptedData>
</encryption>`,
    },
    { name: 'OEBPS/content.opf', data: CONTENT_OPF },
    { name: 'OEBPS/第一章.xhtml', data: CHAPTER_ONE },
    { name: 'OEBPS/chapter2.xhtml', data: CHAPTER_TWO },
  ])
