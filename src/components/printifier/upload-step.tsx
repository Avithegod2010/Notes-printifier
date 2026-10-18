'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Clock,
  CloudDownload,
  FileText,
  FolderUp,
  Globe,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { usePrintifyStore } from '@/lib/printify-store';
import { BatchQueue } from './batch-queue';
import {
  downloadBlob,
  getRecentSource,
  listRecentJobs,
  listRecentSources,
  removeRecentJob,
  type RecentJob,
} from '@/lib/recent-jobs';
import { treesFor } from '@/lib/ink-stats';
import { loadInkStats, type InkStats } from '@/lib/ink-stats';
import { formatRupees } from '@/lib/savings';
import { useT } from '@/lib/i18n';
import { HAS_SERVER_API } from '@/lib/server-api';
import { showServerFeature } from '@/components/printifier/server-feature';

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
  const t = useT();
  const addFiles = usePrintifyStore((s) => s.addFiles);
  const docs = usePrintifyStore((s) => s.docs);
  const removeDoc = usePrintifyStore((s) => s.removeDoc);
  const loadingDocs = usePrintifyStore((s) => s.loadingDocs);
  const loadProgress = usePrintifyStore((s) => s.loadProgress);
  const loadError = usePrintifyStore((s) => s.loadError);
  const setStep = usePrintifyStore((s) => s.setStep);
  const pages = usePrintifyStore((s) => s.pages);

  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [recent, setRecent] = useState<RecentJob[]>([]);
  const [reprintable, setReprintable] = useState<Set<string>>(new Set());
  const [impact, setImpact] = useState<InkStats | null>(null);
  const [reprinting, setReprinting] = useState(false);

  // Folder (batch / teacher mode) import — the directory attributes are not
  // in React's typings, so they are set imperatively once on mount.
  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '');
    folderRef.current?.setAttribute('directory', '');
  }, []);

  // ---- cloud import (#8) ---------------------------------------------------
  // On static builds (GitHub Pages / APK) the section stays visible but the
  // toggle opens the "needs the server" explainer instead of expanding.
  const [cloudOpen, setCloudOpen] = useState(false);
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);

  const toggleCloud = useCallback(() => {
    if (!HAS_SERVER_API) {
      showServerFeature(t('up.cloud'));
      return;
    }
    setCloudOpen((v) => !v);
  }, [t]);

  const importFromCloud = useCallback(async () => {
    if (!HAS_SERVER_API) {
      showServerFeature(t('up.cloud'));
      return;
    }
    const url = cloudUrl.trim();
    if (!url || cloudBusy) return;
    setCloudBusy(true);
    setCloudError(null);
    try {
      const res = await fetch(`/api/cloud-import?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setCloudError(data?.error ?? t('up.cloudFail'));
        return;
      }
      const blob = await res.blob();
      const file = new File([blob], 'cloud-import.pdf', { type: 'application/pdf' });
      await addFiles([file]);
      setCloudOpen(false);
      setCloudUrl('');
    } catch {
      setCloudError(t('up.cloudFail'));
    } finally {
      setCloudBusy(false);
    }
  }, [cloudUrl, cloudBusy, addFiles, t]);

  // Private on-device history — shown when no files are loaded, refreshed
  // whenever the user comes back to this step.
  const refreshRecent = useCallback(() => {
    void listRecentJobs().then(setRecent);
    void listRecentSources().then((sources) => {
      setReprintable(new Set(sources.map((s) => s.id)));
    });
    setImpact(loadInkStats().jobs > 0 ? loadInkStats() : null);
  }, []);
  useEffect(() => {
    if (docs.length === 0) refreshRecent();
  }, [docs.length, refreshRecent]);

  /** Re-run a history job's ORIGINAL files through the pipeline. */
  const reprint = useCallback(
    async (job: RecentJob) => {
      if (reprinting) return;
      setReprinting(true);
      try {
        const src = await getRecentSource(job.id);
        if (!src || src.files.length === 0) return;
        const files = src.files.map(
          (f) => new File([f.blob], f.name, { type: 'application/pdf' }),
        );
        await addFiles(files);
      } finally {
        setReprinting(false);
      }
    },
    [addFiles, reprinting],
  );

  const onPick = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      void addFiles(Array.from(fileList));
    },
    [addFiles],
  );

  const loadSample = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/sample-lecture.pdf`,
      );
      const blob = await res.blob();
      const file = new File([blob], 'sample-lecture-notes.pdf', {
        type: 'application/pdf',
      });
      void addFiles([file]);
    } catch {
      // sample unavailable — silently ignore
    }
  }, [addFiles]);

  // Welcome tour (and other surfaces) can load the sample remotely
  useEffect(() => {
    const onLoad = () => void loadSample();
    window.addEventListener('printifier:load-sample', onLoad);
    return () => window.removeEventListener('printifier:load-sample', onLoad);
  }, [loadSample]);

  const loadPct = loadProgress
    ? Math.round((loadProgress.done / loadProgress.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Lifetime impact meter — local totals, shown right where work starts */}
      {impact && (
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-2xl border border-emerald-400/25 bg-emerald-500/[0.07] px-4 py-2.5 text-center text-xs text-emerald-200/90">
          <span className="font-semibold text-emerald-200">{t('up.impactTitle')}</span>
          <span>
            {t('up.impactJobs', { n: impact.jobs })} · {t('up.impactSheets', { n: impact.sheetsSaved })} ·{' '}
            {t('up.impactRupees', { rs: formatRupees(impact.rupees) })}
          </span>
          <span className="text-emerald-300/70">
            {t('up.impactTrees', { n: treesFor(impact.sheetsSaved) })}
          </span>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        data-dropzone
        aria-label={t('up.aria')}
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
          <p className="text-lg font-semibold">{t('up.drop')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('up.multi')}</p>
        </div>
        <Button
          type="button"
          size="lg"
          className="pointer-events-none bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500"
          disabled={loadingDocs}
        >
          {loadingDocs ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('up.prep')}
            </>
          ) : (
            t('up.select')
          )}
        </Button>
        <p className="text-xs text-muted-foreground">{t('up.privacy')}</p>
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

      {/* Cloud import (#8) — web only (needs the /api/import proxy);
          on static builds the toggle opens the needs-server explainer */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-left"
          onClick={toggleCloud}
          aria-expanded={cloudOpen}
        >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Globe className="h-4 w-4 text-violet-300" />
              {t('up.cloud')}
              <Badge className="ml-1 border-0 bg-fuchsia-500/20 text-[10px] text-fuchsia-200">
                {t('en.badge.new')}
              </Badge>
            </span>
            <span className={`text-xs text-muted-foreground transition-transform ${cloudOpen ? 'rotate-180' : ''}`}>
              ▾
            </span>
          </button>
          {cloudOpen && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={cloudUrl}
                  onChange={(e) => setCloudUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void importFromCloud();
                  }}
                  placeholder={t('up.cloudUrl')}
                  inputMode="url"
                  aria-label={t('up.cloud')}
                />
                <Button
                  type="button"
                  onClick={() => void importFromCloud()}
                  disabled={cloudBusy || !cloudUrl.trim()}
                  className="shrink-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-500 hover:to-fuchsia-500"
                >
                  {cloudBusy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t('up.cloudBusy')}
                    </>
                  ) : (
                    <>
                      <CloudDownload className="mr-2 h-4 w-4" /> {t('up.cloudGo')}
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{t('up.cloudHint')}</p>
              <p className="text-[11px] text-muted-foreground/80">{t('up.cloudNote')}</p>
              {cloudError && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {cloudError}
                </p>
              )}
            </div>
          )}
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
              <Clock className="h-4 w-4 text-violet-300" /> {t('up.recent')}
            </p>
            <Badge variant="outline" className="border-white/15 bg-white/5 text-[10px]">
              {t('up.recentNote')}
            </Badge>
          </div>
          <div className="pretty-scroll max-h-56 space-y-2 overflow-y-auto pr-1">
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
                  {t('up.download')}
                </Button>
                {reprintable.has(job.id) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={reprinting || loadingDocs}
                    aria-label={t('up.reprint')}
                    title={t('up.reprintHint')}
                    className="h-8 shrink-0 border-violet-400/40 text-violet-200 hover:bg-violet-500/15"
                    onClick={() => void reprint(job)}
                  >
                    {reprinting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RotateCcw className="h-3.5 w-3.5" />
                    )}
                    {t('up.reprint')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${t('up.remove')} ${job.name}`}
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
            {t('up.rendering')} {loadProgress.done}/{loadProgress.total}
          </p>
        </div>
      )}

      {docs.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">
            {docs.length} {t('up.files')}
            {pages.length} {t('up.pagesTotal')}
          </p>
          <div className="pretty-scroll max-h-56 space-y-2 overflow-y-auto pr-1">
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
                  aria-label={`${t('up.remove')} ${d.name}`}
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

      {/* F3 — batch queue: one preset per file, each file its own PDF */}
      {docs.length > 0 && <BatchQueue />}

      <div className="flex flex-col-reverse items-center justify-between gap-4 sm:flex-row">
        <div className="flex flex-wrap items-center justify-center gap-1">
          <Button
            type="button"
            variant="ghost"
            onClick={() => void loadSample()}
            disabled={loadingDocs}
            className="text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {t('up.sample')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('up.folderAria')}
            title={t('up.folderSub')}
            onClick={() => folderRef.current?.click()}
            disabled={loadingDocs}
            className="text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
          >
            <FolderUp className="mr-2 h-4 w-4" />
            {t('up.folder')}
          </Button>
          <input
            ref={folderRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              onPick(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        <Button
          type="button"
          size="lg"
          disabled={pages.length === 0 || loadingDocs}
          onClick={() => setStep(1)}
          className="w-full bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-fuchsia-500 sm:w-auto"
        >
          {t('up.continue')} <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
