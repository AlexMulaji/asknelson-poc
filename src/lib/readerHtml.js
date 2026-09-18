import DOMPurify from 'dompurify'

// The browser-side pass over reader-view HTML. The server has already reduced
// the article to an allowlist (server/reader.js); this is the second,
// independent pass, because the markup is rendered on the app's own origin and
// one bug in one sanitiser should not be enough to run a publisher's script.

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'blockquote', 'pre', 'code', 'q', 'cite', 'abbr', 'time',
  'em', 'strong', 'b', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark',
  'a', 'img', 'figure', 'figcaption',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
]
const ALLOWED_ATTR = ['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'datetime']

// Images only ever come from the server's resizing proxy, never straight from
// the publisher: that is what keeps an article light on mobile data.
const PROXY_PREFIX = '/api/reader/image?'
// Must match IMAGE_WIDTHS in server/reader.js.
const IMAGE_WIDTHS = [480, 800, 1200]
// The reader column is at most 680px wide, minus its 20px side padding.
const IMAGE_SIZES = '(max-width: 680px) calc(100vw - 40px), 640px'

/** srcset for a proxied image: the same signed image at each allowed width. */
export function proxiedSrcset(src) {
  if (!src.startsWith(PROXY_PREFIX)) return null
  const params = new URLSearchParams(src.slice(PROXY_PREFIX.length))
  return IMAGE_WIDTHS.map((w) => {
    params.set('w', String(w))
    return `${PROXY_PREFIX}${params} ${w}w`
  }).join(', ')
}

let hooked = false

// Links inside an article leave the app in a new tab; images load lazily at
// the width the screen actually needs.
function addHooks() {
  if (hooked) return
  hooked = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    }
    if (node.tagName === 'IMG') {
      const srcset = proxiedSrcset(node.getAttribute('src') || '')
      // Anything but a proxied image is hidden rather than removed: taking a
      // node out mid-walk would upset DOMPurify's own traversal.
      if (!srcset) {
        node.removeAttribute('src')
        node.setAttribute('hidden', '')
        return
      }
      node.setAttribute('srcset', srcset)
      node.setAttribute('sizes', IMAGE_SIZES)
      node.setAttribute('loading', 'lazy')
      node.setAttribute('decoding', 'async')
    }
  })
}

export function sanitiseReaderHtml(html) {
  addHooks()
  return DOMPurify.sanitize(html ?? '', {
    ALLOWED_TAGS,
    // target/rel/srcset/loading are set by the hook above, after the
    // allowlist ran, from values it has already vetted.
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/api\/reader\/image\?)/i,
    ALLOW_DATA_ATTR: false,
  })
}
