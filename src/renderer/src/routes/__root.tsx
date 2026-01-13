import { useState } from 'react'
import '../assets/global.css'
import { createRootRoute } from '@tanstack/react-router'
import { Providers } from '@renderer/components/providers'
import { FileDropZone } from '@renderer/components/file-drop-zone'
import { Card } from '@renderer/components/ui/card'
import { FileText } from 'lucide-react'

export const Route = createRootRoute({
  component: RootComponent
})

function RootComponent() {
  const [filePath, setFilePath] = useState<string>('')
  const [content, setContent] = useState<string>('')

  const handleFileSelect = async (file: File) => {
    let path = ''
    try {
      if (window.api && typeof window.api.getPathForFile === 'function') {
        path = window.api.getPathForFile(file)
      } else {
        console.warn(
          'window.api.getPathForFile is not available. Please restart the application to apply preload changes.'
        )
        path = (file as File & { path: string }).path
      }
    } catch (e) {
      console.warn('Failed to get path via webUtils, falling back to file.path', e)
      path = (file as File & { path: string }).path
    }

    console.log('[Renderer] File selected:', { name: file.name, path: path, size: file.size })

    if (!path) {
      setContent(
        'Error: File path is missing. If you just updated the code, please RESTART the application terminal/process.'
      )
      return
    }

    if (path) {
      setFilePath(path)
      setContent('Reading file...')
      try {
        console.log('[Renderer] Invoking read-file IPC with path:', path)
        const result = await window.electron.ipcRenderer.invoke('read-file', path)
        console.log('[Renderer] IPC Result length:', result ? result.length : 'null')

        if (typeof result === 'string') {
          setContent(result)
        } else {
          setContent('Error: Failed to read file (IPC returned null)')
        }
      } catch (err) {
        console.error('[Renderer] IPC Error:', err)
        setContent('Error reading file: ' + (err instanceof Error ? err.message : String(err)))
      }
    } else {
      console.warn(
        '[Renderer] File object is missing "path" property. Is webPreferences.sandbox disabled?'
      )
      setContent('Error: Could not determine file path. (File.path is empty)')
    }
  }

  return (
    <Providers>
      <div className="w-screen h-screen flex flex-col items-center justify-center p-8 bg-background text-foreground">
        <div className="max-w-2xl w-full flex flex-col gap-6">
          <div className="space-y-2 text-center">
            <h1 className="text-3xl font-bold tracking-tight">System Log Viewer</h1>
            <p className="text-muted-foreground">Upload, view and analyze system logs</p>
          </div>

          <FileDropZone onFileSelect={handleFileSelect} accept=".txt,.log" />

          {filePath && (
            <Card className="p-4 bg-card animate-in fade-in slide-in-from-bottom-4 border-2">
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3 pb-4 border-b">
                  <div className="p-2 bg-primary/10 rounded-full">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-semibold text-sm">Selected File</span>
                    <code className="text-xs text-muted-foreground">{filePath}</code>
                  </div>
                </div>
                {content && (
                  <div className="mt-2">
                    <h3 className="text-sm font-medium mb-2">Preview</h3>
                    <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-x-auto max-h-[200px] whitespace-pre-wrap break-all">
                      {content.slice(0, 500)}
                      {content.length > 500 && '...'}
                    </pre>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </Providers>
  )
}
