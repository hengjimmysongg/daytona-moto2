/**
 * Handing the browser a file.
 *
 * A blob URL and a synthetic click is how a page saves something it made
 * itself. The URL is released immediately after: it is what keeps the blob
 * alive, and a season of exports adds up.
 */

export function downloadFile(contents: string, filename: string, type: string): void {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * The leading byte-order mark is not decoration: without it Excel opens a
 * UTF-8 CSV in the system codepage, and every °C in the header turns to
 * mojibake.
 */
export function downloadCsv(contents: string, filename: string): void {
  downloadFile(`﻿${contents}`, filename, 'text/csv;charset=utf-8')
}
