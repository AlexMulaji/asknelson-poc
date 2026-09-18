import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import sharp from 'sharp'
import {
  createReaderRouter,
  extractArticle,
  proxiedImageSrc,
  resizeForMobile,
  sanitiseArticleHtml,
  signImageUrl,
} from '../server/reader.js'
import { proxiedSrcset } from '../src/lib/readerHtml.js'

// Reader view renders a publisher's HTML on AskNelson's own origin, so the
// sanitiser is the part that matters most: anything it lets through runs with
// the member's session. The route is tested with the fetch stubbed out — the
// network rules it shares with the embed check are covered by embed.js.

const BASE = 'https://publisher.example/articles/stress'

// --- sanitiseArticleHtml ---------------------------------------------------------

test('drops scripts, styles, frames and forms along with their contents', () => {
  const out = sanitiseArticleHtml(
    '<p>Keep</p><script>alert(1)</script><style>p{}</style><iframe src="https://x"></iframe>' +
      '<form><input value="x"><button>Go</button></form><noscript>ns</noscript><svg><script>1</script></svg>',
    BASE
  )
  assert.equal(out, '<p>Keep</p>')
})

test('strips event handlers, styles, classes and ids', () => {
  const out = sanitiseArticleHtml(
    '<p onclick="steal()" style="color:red" class="x" id="y" onmouseover="z">Text</p>',
    BASE
  )
  assert.equal(out, '<p>Text</p>')
})

test('keeps only safe link schemes, made absolute', () => {
  const out = sanitiseArticleHtml(
    '<a href="javascript:alert(1)">js</a><a href="data:text/html,x">data</a>' +
      '<a href="/help">rel</a><a href="mailto:a@b.co">mail</a><a href="vbscript:x">vb</a>',
    BASE
  )
  assert.equal(
    out,
    '<a>js</a><a>data</a><a href="https://publisher.example/help">rel</a>' +
      '<a href="mailto:a@b.co">mail</a><a>vb</a>'
  )
})

test('keeps https images, finds lazy-loaded ones, and drops the rest', () => {
  const out = sanitiseArticleHtml(
    '<img src="/a.jpg" alt="A" onerror="x()">' +
      '<img src="data:image/gif;base64,R0" data-src="https://cdn.example/b.jpg">' +
      '<img srcset="https://cdn.example/c.jpg 1x, https://cdn.example/c2.jpg 2x">' +
      '<img src="http://insecure.example/d.jpg">' +
      '<img src="javascript:alert(1)">',
    BASE
  )
  assert.equal(
    out,
    '<img alt="A" src="https://publisher.example/a.jpg">' +
      '<img src="https://cdn.example/b.jpg">' +
      '<img src="https://cdn.example/c.jpg">'
  )
})

test('unwraps layout tags but keeps their text', () => {
  const out = sanitiseArticleHtml(
    '<div><section><span>One</span> <font>two</font> <custom-el>three</custom-el></section></div>',
    BASE
  )
  assert.equal(out, 'One two three')
})

test('turns h1 into h2 so the viewer title stays the only h1', () => {
  assert.equal(sanitiseArticleHtml('<h1 class="t">Heading</h1>', BASE), '<h2>Heading</h2>')
})

test('removes comments, including conditional-comment tricks', () => {
  assert.equal(sanitiseArticleHtml('<p>a<!-- <script>x</script> -->b</p>', BASE), '<p>ab</p>')
})

test('keeps sane table spans and nothing else on cells', () => {
  const out = sanitiseArticleHtml(
    '<table><tr><td colspan="2" width="9" rowspan="999">x</td><td colspan="abc">y</td></tr></table>',
    BASE
  )
  assert.match(out, /<td colspan="2">x<\/td><td>y<\/td>/)
})

// --- extractArticle ----------------------------------------------------------------

const paragraph = `<p>${'Stress at work is common and there are practical ways to manage it. '.repeat(15)}</p>`

function page({ body, title = 'Managing stress' } = {}) {
  return `<!doctype html><html lang="en"><head><title>${title}</title>
    <meta property="og:site_name" content="Publisher"></head>
    <body><nav><a href="/">Home</a> <a href="/about">About</a></nav>
    ${body ?? `<article><h1>${title}</h1><p class="byline">By Sam Writer</p>${paragraph}${paragraph}
      <img src="/pic.jpg" alt="Pic"><script>track()</script></article>`}
    <footer>Copyright</footer></body></html>`
}

test('extracts the article, its metadata and a reading time', () => {
  const result = extractArticle(page(), BASE)
  assert.equal(result.readable, true)
  assert.equal(result.title, 'Managing stress')
  assert.equal(result.siteName, 'Publisher')
  assert.equal(result.lang, 'en')
  assert.equal(result.dir, 'ltr')
  assert.ok(result.minutes >= 1)
  assert.match(result.content, /Stress at work is common/)
  assert.doesNotMatch(result.content, /<script|track\(\)|Copyright/)
})

test('a page with too little text is not treated as an article', () => {
  const result = extractArticle(page({ body: '<p>Subscribe to keep reading.</p>' }), BASE)
  assert.deepEqual(result, { readable: false, reason: 'no-article' })
})

// --- route ---------------------------------------------------------------------------

const SECRET = 'test-secret'

async function startServer(fetchPage, fetchImage = () => ({ reason: 'unavailable' })) {
  const calls = []
  const imageCalls = []
  const app = express()
  app.use(
    '/api/reader',
    createReaderRouter({
      allowedHosts: () => new Set(['publisher.example']),
      imageSecret: SECRET,
      fetchPage: async (url) => {
        calls.push(url.href)
        return fetchPage(url)
      },
      fetchImage: async (url) => {
        imageCalls.push(url.href)
        return fetchImage(url)
      },
    })
  )
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  after(() => server.close())
  const origin = `http://127.0.0.1:${server.address().port}`
  const base = `${origin}/api/reader`
  const get = (url) => fetch(`${base}?url=${encodeURIComponent(url)}`)
  const getPath = (path) => fetch(`${origin}${path}`)
  return { get, getPath, calls, imageCalls }
}

test('refuses hosts the content does not link to', async () => {
  const { get, calls } = await startServer(() => ({ html: page(), url: new URL(BASE) }))
  const res = await get('https://evil.example/x')
  assert.equal(res.status, 403)
  assert.equal(calls.length, 0)
  assert.equal((await get('not a url')).status, 400)
})

test('returns the article with the final URL, and serves repeats from cache', async () => {
  const { get, calls } = await startServer(() => ({
    html: page(),
    url: new URL('https://publisher.example/articles/stress?ref=final'),
  }))
  const first = await (await get(BASE)).json()
  assert.equal(first.readable, true)
  assert.equal(first.url, 'https://publisher.example/articles/stress?ref=final')
  await get(BASE)
  assert.equal(calls.length, 1)
})

test('reports why a page could not be read instead of failing', async () => {
  const { get } = await startServer(() => ({ reason: 'unavailable' }))
  assert.deepEqual(await (await get(BASE)).json(), { readable: false, reason: 'unavailable' })
})

test('a fetch that throws becomes "unreachable", not a 500', async () => {
  const { get } = await startServer(() => {
    throw new Error('Host does not resolve to a public address')
  })
  const res = await get(BASE)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { readable: false, reason: 'unreachable' })
})

// --- images ----------------------------------------------------------------------------

// A camera-sized photo: the kind of image a publisher serves to desktops.
const bigPhoto = () =>
  sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#89BA16' } })
    .jpeg({ quality: 95 })
    .toBuffer()

test('images in an extracted article point at the signed resizing proxy', () => {
  const imageSrc = (url) => proxiedImageSrc(url, { secret: SECRET })
  const result = extractArticle(page(), BASE, { imageSrc })
  const src = /<img[^>]+src="([^"]+)"/.exec(result.content)[1].replaceAll('&amp;', '&')
  assert.ok(src.startsWith('/api/reader/image?'))
  const params = new URLSearchParams(src.split('?')[1])
  assert.equal(params.get('u'), 'https://publisher.example/pic.jpg')
  assert.equal(params.get('w'), '800')
  assert.equal(params.get('s'), signImageUrl('https://publisher.example/pic.jpg', SECRET))
})

test('shrinks a large photo to a phone-sized WebP', async () => {
  const input = await bigPhoto()
  const output = await resizeForMobile(input, 800)
  const meta = await sharp(output).metadata()
  assert.equal(meta.format, 'webp')
  assert.equal(meta.width, 800)
  assert.equal(meta.height, 533)
  assert.ok(output.length < input.length / 5, `${output.length} vs ${input.length}`)
})

test('never enlarges a small image', async () => {
  const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#000' } })
    .png()
    .toBuffer()
  const meta = await sharp(await resizeForMobile(small, 1200)).metadata()
  assert.equal(meta.width, 300)
})

test('refuses SVG and anything else that is not a plain raster image', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  await assert.rejects(resizeForMobile(svg), (err) => err.status === 415)
  await assert.rejects(resizeForMobile(Buffer.from('<html></html>')), (err) => err.status === 415)
})

test('the image route serves a resized WebP for the image an article linked', async () => {
  const photo = await bigPhoto()
  const { get, getPath, imageCalls } = await startServer(
    () => ({ html: page(), url: new URL(BASE) }),
    () => ({ bytes: photo })
  )
  const article = await (await get(BASE)).json()
  const src = /<img[^>]+src="([^"]+)"/.exec(article.content)[1].replaceAll('&amp;', '&')

  const res = await getPath(src)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('content-type'), 'image/webp')
  assert.match(res.headers.get('cache-control'), /immutable/)
  const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata()
  assert.equal(meta.width, 800)

  // A second request is served from the cache, not refetched.
  await getPath(src)
  assert.equal(imageCalls.length, 1)
})

test('the image route refuses unsigned URLs and unsupported widths', async () => {
  const { getPath, imageCalls } = await startServer(() => ({ reason: 'unavailable' }))
  const target = 'https://internal.example/secret.png'

  const forged = new URLSearchParams({ u: target, w: '800', s: 'x'.repeat(32) })
  assert.equal((await getPath(`/api/reader/image?${forged}`)).status, 403)

  const missing = new URLSearchParams({ u: target, w: '800' })
  assert.equal((await getPath(`/api/reader/image?${missing}`)).status, 403)

  // Signed for one URL, used for another.
  const swapped = new URLSearchParams({ u: target, w: '800', s: signImageUrl('https://publisher.example/a.jpg', SECRET) })
  assert.equal((await getPath(`/api/reader/image?${swapped}`)).status, 403)

  const odd = new URLSearchParams({ u: target, w: '5000', s: signImageUrl(target, SECRET) })
  assert.equal((await getPath(`/api/reader/image?${odd}`)).status, 400)

  assert.equal(imageCalls.length, 0)
})

test('an image that cannot be fetched is a 502, not a crash', async () => {
  const { getPath } = await startServer(() => ({ reason: 'unavailable' }))
  const url = 'https://publisher.example/gone.jpg'
  const q = new URLSearchParams({ u: url, w: '480', s: signImageUrl(url, SECRET) })
  assert.equal((await getPath(`/api/reader/image?${q}`)).status, 502)
})

// --- client srcset -----------------------------------------------------------------------

test('the reader offers each proxied image at every allowed width', () => {
  const src = proxiedImageSrc('https://publisher.example/a.jpg', { secret: SECRET })
  const srcset = proxiedSrcset(src)
  const entries = srcset.split(', ')
  assert.deepEqual(entries.map((e) => e.split(' ')[1]), ['480w', '800w', '1200w'])
  for (const entry of entries) {
    const params = new URLSearchParams(entry.split(' ')[0].split('?')[1])
    // Same image and signature; only the width changes.
    assert.equal(params.get('u'), 'https://publisher.example/a.jpg')
    assert.equal(params.get('s'), signImageUrl('https://publisher.example/a.jpg', SECRET))
  }
  assert.equal(proxiedSrcset('https://publisher.example/a.jpg'), null)
})
