import { useEffect, useRef, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

function ArrowUpRight() {
  return <span aria-hidden="true">↗</span>
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="upload-icon">
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 14.5v3A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-3" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="search-icon">
      <circle cx="10.8" cy="10.8" r="6.2" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  )
}

function formatDate(value) {
  if (!value) return 'Just now'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently added'
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function RecordCard({ record }) {
  const numbers = record.numbers?.length ? record.numbers : record.number ? [record.number] : []
  return (
    <article className="record-card">
      <div className="record-image-wrap">
        <img src={record.image_url} alt={`Scan containing ${numbers.join(', ') || 'no detected number'}`} className="record-image" />
        <span className="image-tag">IMAGE</span>
      </div>
      <div className="record-meta">
        <div>
          <span className="meta-label">Detected numbers</span>
          <strong className="record-number">{numbers.join(', ') || 'Not found'}</strong>
        </div>
        <span className="record-date">{formatDate(record.created_at)}</span>
      </div>
    </article>
  )
}

export default function App() {
  const inputRef = useRef(null)
  const [files, setFiles] = useState([])
  const [previews, setPreviews] = useState([])
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploadError, setUploadError] = useState('')
  const [searchNumber, setSearchNumber] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searchActive, setSearchActive] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [page, setPage] = useState(1)
  const [archive, setArchive] = useState({ items: [], page: 1, limit: 10, total: 0, totalPages: 0 })
  const [archiveLoading, setArchiveLoading] = useState(true)
  const [archiveError, setArchiveError] = useState('')
  const [refreshArchive, setRefreshArchive] = useState(0)

  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file))
    setPreviews(urls)
    return () => urls.forEach((url) => URL.revokeObjectURL(url))
  }, [files])

  useEffect(() => {
    const controller = new AbortController()
    async function loadArchive() {
      setArchiveLoading(true)
      setArchiveError('')
      try {
        const response = await fetch(`${API_URL}/images/all?page=${page}&limit=10`, { signal: controller.signal })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(data.message || 'Could not load the image archive.')
        setArchive(data)
      } catch (error) {
        if (error.name !== 'AbortError') setArchiveError(error.message)
      } finally {
        if (!controller.signal.aborted) setArchiveLoading(false)
      }
    }
    loadArchive()
    return () => controller.abort()
  }, [page, refreshArchive])

  function chooseFiles(fileList) {
    const incoming = Array.from(fileList || [])
    const valid = incoming.filter((file) => file.type.startsWith('image/'))
    const invalidCount = incoming.length - valid.length
    const existingKeys = new Set(files.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
    const unique = valid.filter((file) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`
      if (existingKeys.has(key)) return false
      existingKeys.add(key)
      return true
    })
    const accepted = unique.slice(0, Math.max(0, 10 - files.length))
    if (accepted.length) setFiles((current) => [...current, ...accepted])
    setUploadResult(null)
    if (invalidCount) setUploadError('Some files were skipped. Choose image files only.')
    else if (unique.length > accepted.length) setUploadError('You can upload up to 10 images at a time.')
    else if (accepted.length) setUploadError('')
  }

  function onDrop(event) {
    event.preventDefault()
    chooseFiles(event.dataTransfer.files)
  }

  async function uploadImage(event) {
    event.preventDefault()
    if (!files.length) {
      setUploadError('Add at least one image first.')
      return
    }
    setUploading(true)
    setUploadError('')
    try {
      const body = new FormData()
      files.forEach((file) => body.append('files', file))
      const response = await fetch(`${API_URL}/images/bulk`, { method: 'POST', body })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.message || data.detail || 'The images could not be processed.')
      const detectedNumbers = [...new Set(data.items.flatMap((item) => item.numbers || (item.number ? [item.number] : [])))]
      setUploadResult({ successful: data.successful, total: data.total, numbers: detectedNumbers })
      if (data.successful > 0) {
        setFiles([])
        setSearchActive(false)
        setSearchError('')
        setPage(1)
        setRefreshArchive((current) => current + 1)
      }
      setUploadError(data.failed ? `${data.failed} of ${data.total} images failed: ${data.errors.map((item) => `${item.filename} (${item.error})`).join('; ')}` : '')
    } catch (error) {
      setUploadError(error.message)
    } finally {
      setUploading(false)
    }
  }

  async function searchImages(event) {
    event.preventDefault()
    const query = searchNumber.trim()
    if (!query) {
      setSearchError('Enter a number to search.')
      return
    }
    setSearching(true)
    setSearchError('')
    try {
      const response = await fetch(`${API_URL}/images?number=${encodeURIComponent(query)}`)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'Search failed.')
      setSearchResults(data)
      setSearchActive(true)
      if (!data.length) setSearchError(`No scans found for ${query}.`)
    } catch (error) {
      setSearchError(error.message)
      setSearchResults([])
      setSearchActive(true)
    } finally {
      setSearching(false)
    }
  }

  function browseAll() {
    setSearchActive(false)
    setSearchError('')
    setPage(1)
  }

  const visibleRecords = searchActive ? searchResults : archive.items

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="/" aria-label="Image Index home">
          <span className="wordmark-mark">◎</span> image index
        </a>
        <div className="status-pill"><span className="status-dot" /> OCR archive online</div>
      </header>

      <section className="archive-section archive-section--top" aria-label="Image archive">
        <div className="archive-heading">
          <div>
            <p className="eyebrow">{searchActive ? 'Archive query' : 'Your collection'}</p>
            <h2>{searchActive ? 'Search results' : 'All images'}</h2>
            <p className="archive-count" aria-live="polite">
              {searchActive ? `${searchResults.length} matching ${searchResults.length === 1 ? 'image' : 'images'}` : `${archive.total} ${archive.total === 1 ? 'image' : 'images'}`}
            </p>
          </div>
          {searchActive && <button className="browse-all-button" type="button" onClick={browseAll}>Show all images <span aria-hidden="true">↗</span></button>}
        </div>

        {((searchActive && searching) || (!searchActive && archiveLoading)) ? (
          <div className="image-grid" role="status" aria-label="Loading images">
            {Array.from({ length: 6 }, (_, index) => <div className="archive-skeleton" key={index} />)}
          </div>
        ) : visibleRecords.length ? (
          <div className="image-grid">
            {visibleRecords.map((record) => <RecordCard key={record.id} record={record} />)}
          </div>
        ) : (
          <div className="archive-empty">
            <span className="empty-glyph">⌁</span>
            <p>{searchActive ? searchError || 'No matching scans.' : archiveError || 'No images yet. Upload a scan to start your archive.'}</p>
            {!searchActive && archiveError && <button className="retry-button" type="button" onClick={() => setRefreshArchive((current) => current + 1)}>Try again</button>}
          </div>
        )}

        {!searchActive && archive.totalPages > 1 && (
          <nav className="pagination" aria-label="Image archive pages">
            <button type="button" onClick={() => setPage((current) => current - 1)} disabled={archiveLoading || page <= 1}>← Previous</button>
            <span>Page {page} of {archive.totalPages}<small>{archive.total} images</small></span>
            <button type="button" onClick={() => setPage((current) => current + 1)} disabled={archiveLoading || page >= archive.totalPages}>Next →</button>
          </nav>
        )}
      </section>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Visual search / 01</p>
          <h1>Find the number<br /><em>inside</em> the image.</h1>
          <p className="hero-note">Drop a scan into the index. We’ll read its number, keep the image safe, and make it searchable.</p>
        </div>
        <div className="hero-stamp" aria-hidden="true">
          <span>SCAN</span>
          <strong>→</strong>
          <span>FIND</span>
        </div>
      </section>

      <section className="workspace" aria-label="Image tools">
        <form className="upload-panel panel" onSubmit={uploadImage}>
          <div className="panel-heading">
            <div><p className="eyebrow">New scan</p><h2>Upload an image</h2></div>
            <span className="panel-index">A</span>
          </div>
          <div
            className={`dropzone ${files.length ? 'dropzone--ready' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex="0"
            onKeyDown={(event) => event.key === 'Enter' && inputRef.current?.click()}
          >
            {files.length ? (
              <div className="selected-files" aria-label={`${files.length} images selected`}>
                {files.map((selectedFile, index) => (
                  <div className="selected-file" key={`${selectedFile.name}-${selectedFile.size}-${selectedFile.lastModified}`}>
                    <img src={previews[index]} alt="" />
                    <span>{selectedFile.name}</span>
                  </div>
                ))}
              </div>
            ) : <UploadIcon />}
            <div className="dropzone-copy">
              <strong>{files.length ? `${files.length} image${files.length === 1 ? '' : 's'} selected` : 'Drop your images here'}</strong>
              <span>{files.length ? 'Add up to 10 images per upload' : 'or click to browse multiple files'}</span>
            </div>
            <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={(event) => { chooseFiles(event.target.files); event.target.value = '' }} />
          </div>
          {uploadError && <p className="error-message">{uploadError}</p>}
          <button className="primary-button" type="submit" disabled={uploading}>
            {uploading ? 'Uploading images…' : files.length > 1 ? `Upload ${files.length} images` : 'Upload image'} <ArrowUpRight />
          </button>
          {uploadResult && (
            <div className="result-callout">
              <span className="meta-label">Images uploaded</span>
              <strong>{uploadResult.successful} / {uploadResult.total}</strong>
              {uploadResult.numbers.length > 0 && <small>Numbers: {uploadResult.numbers.join(', ')}</small>}
            </div>
          )}
        </form>

        <section className="search-panel panel">
          <div className="panel-heading">
            <div><p className="eyebrow">Archive query</p><h2>Search the index</h2></div>
            <span className="panel-index">B</span>
          </div>
          <form className="search-form" onSubmit={searchImages}>
            <label htmlFor="number-search">Search within detected numbers</label>
            <div className="search-input-wrap">
              <SearchIcon />
              <input id="number-search" value={searchNumber} onChange={(event) => setSearchNumber(event.target.value)} placeholder="e.g. 908771" inputMode="numeric" />
              <button type="submit" disabled={searching}>{searching ? '…' : 'Search'}</button>
            </div>
          </form>
        </section>
      </section>

      <footer className="footer"><span>Image Index / private archive</span><span>Powered by OCR + Firestore</span></footer>
    </main>
  )
}
