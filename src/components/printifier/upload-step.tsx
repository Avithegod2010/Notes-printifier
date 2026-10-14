'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Clock, FileText, Loader2, Sparkles, Trash2, UploadCloud, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { usePrintifyStore } from '@/lib/printify-store';
import {
  downloadBlob,
  listRecentJobs,
  removeRecentJob,
  type RecentJob,
} from '@/lib/recent-jobs';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

export function UploadStep() {
  const addFiles = usePrintifyStore((s) => s.addFiles);
  const docs = usePrintifyStore((s) => s.docs);
  const removeDoc = usePrintifyStore((s) => s.removeDoc);
  const loadingDocs = usePrintifyStore((s) => s.loadingDocs);
  const loadProgress = usePrintifyStore((s) => s.loadProgress);
  const loadError = usePrintifyStore((s) => s.loadError);
  const setStep = usePrintifyStore((s) => s.setStep);
  const pages = usePrintifyStore((s) => s.pages);

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [recent, setRecent] = useState<RecentJob[]>([]);

  // Private on-device history — shown when no files are loaded, refreshed
  // whenever the user comes back to this step.
  const refreshRecent = useCallback(() => {
    void listRecentJobs().then(setRecent);
  }, []);
  useEffect(() => {
    if (docs.length === 0) refreshRecent();
  }, [docs.length, refreshRecent]);

  const onPick = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      void addFiles(Array.from(fileList));
    },
    [addFiles],
  );

  const loadSample = useCallback(async () => {
    try {
      const res = await fetch('/sample-lecture.pdf');
      const blob = await res.blob();
      const file = new File([blob], 'sample-lecture-notes.pdf', {
        type: 'application/pdf',
      });
      void addFiles([file]);
    } catch {
      // sample unavailable — silently ignore
    }
  }, [addFiles]);

  const loadPct = loadProgress
    ? Math.round((loadProgress.done / loadProgress.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload PDF files"
        onClick={() => !loadingDocs && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !loadingDocs) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!loadingDocs) onPick(e.dataTransfer.files);
        }}
        className={`group relative flex cursor-pointer flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-8 text-center transition-all sm:p-12 ${
          dragOver
            ? 'border-primary bg-primary/10'
            : 'border-white/15 bg-white/[0.02] hover:border-primary/50 hover:bg-primary/5'
        }`}
      >
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-600/30 transition-transform group-hover:scale-105">
          <UploadCloud className="h-8 w-8 text-white" />
        </div>
        <div>
          <p className="text-lg font-semibold">Drop your lecture PDFs here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Multiple PDFs supported — pages are merged in order
          </p>
        </div>
        <Button
          type="button"
          size="lg"
          className="pointer-events-none bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500"
          disabled={loadingDocs}
        >
          {loadingDocs ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Preparing previews…
            </>
          ) : (
            'Select PDF(s)'
          )}
        </Button>
        <p className="text-xs text-muted-foreground">
          🔒 Files never leave your device — everything runs locally in your browser
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            onPick(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {loadError && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {loadError}
        </p>
      )}

      {docs.length === 0 && recent.length > 0 && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 text-violet-300" /> Recent conversions
            </p>
            <Badge variant="outline" className="border-white/15 bg-white/5 text-[10px]">
              stored only on this device
            </Badge>
          </div>
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1 pretty-scroll">
            {recent.map((job) => (
              <div
                key={job.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5"
              >
                <FileText className="h-5 w-5 shrink-0 text-violet-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{job.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.inputPages} → {job.outputPages} pages ·{' '}
                    {formatBytes(job.outputBytes)} · {timeAgo(job.ts)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0"
                  onClick={() =>
                    downloadBlob(job.blob, `printified-${job.outputPages}p.pdf`)
                  }
                >
                  Download
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${job.name} from history`}
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-red-400"
                  onClick={() => {
                    void removeRecentJob(job.id);
                    setRecent((r) => r.filter((j) => j.id !== job.id));
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loadingDocs && loadProgress && (
        <div className="space-y-2">
          <Progress value={loadPct} className="h-2" />
          <p className="text-center text-xs text-muted-foreground">
            Rendering page previews… {loadProgress.done}/{loadProgress.total} file(s)
          </p>
        </div>
      )}

      {docs.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">
            {docs.length} file{docs.length > 1 ? 's' : ''} · {pages.length} pages total
          </p>
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1 pretty-scroll">
            {docs.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
              >
                <FileText className="h-5 w-5 shrink-0 text-violet-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(d.size)}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">
                  {d.pageCount} pages
                </Badge>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${d.name}`}
                  onClick={() => removeDoc(d.id)}
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-red-400"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse items-center justify-between gap-4 sm:flex-row">
        <Button
          type="button"
          variant="ghost"
          onClick={() => void loadSample()}
          disabled={loadingDocs}
          className="text-violet-300 hover:text-violet-200 hover:bg-violet-500/10"
        >
          <Sparkles className="mr-2 h-4 w-4" />
          Try a sample lecture PDF
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={pages.length === 0 || loadingDocs}
          onClick={() => setStep(1)}
          className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500 sm:w-auto"
        >
          Continue <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
