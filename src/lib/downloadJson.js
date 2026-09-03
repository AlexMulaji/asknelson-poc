// Save a dataset to the user's machine as a .json file.
//
// This is the bridge between the admin console and the repo: content edits live
// in the server's data directory (outside git), so the only way to get them
// under version control is to export them and commit the result. The formatting
// deliberately matches what the server writes — 2-space indent, trailing
// newline — so a committed file produces a clean `git diff`.
export function downloadJson(filename, data) {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
