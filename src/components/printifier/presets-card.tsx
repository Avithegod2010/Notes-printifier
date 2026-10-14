'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Check, Share2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePrintifyStore } from '@/lib/printify-store';
import {
  loadPresets,
  mergeImportedPresets,
  serializePresets,
} from '@/lib/presets';
import { downloadBlob } from '@/lib/recent-jobs';
import { useT } from '@/lib/i18n';

/**
 * Saved presets (#2) — one-tap restore of a full Enhance + Layout recipe.
 * Presets live in localStorage; nothing leaves the device.
 */
export function PresetsCard() {
  const t = useT();
  const presets = usePrintifyStore((s) => s.presets);
  const savePreset = usePrintifyStore((s) => s.savePreset);
  const applyPreset = usePrintifyStore((s) => s.applyPreset);
  const deletePreset = usePrintifyStore((s) => s.deletePreset);
  const refreshPresets = usePrintifyStore((s) => s.refreshPresets);

  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!importMsg) return;
    const timer = setTimeout(() => setImportMsg(null), 2600);
    return () => clearTimeout(timer);
  }, [importMsg]);

  const onExport = useCallback(() => {
    const list = loadPresets();
    if (list.length === 0) return;
    downloadBlob(
      new Blob([serializePresets(list)], { type: 'application/json' }),
      'printifier-presets.json',
    );
  }, []);

  const onImportFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        const n = mergeImportedPresets(await file.text());
        if (n > 0) {
          refreshPresets();
          setImportMsg(
            t('en.presets.imported', { n, s: n === 1 ? '' : 's' }),
          );
        } else {
          setImportMsg(t('en.presets.importFail'));
        }
      } catch {
        setImportMsg(t('en.presets.importFail'));
      }
    },
    [refreshPresets, t],
  );

  const onSave = () => {
    savePreset(name);
    setNaming(false);
    setName('');
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1600);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <BookmarkPlus className="h-4 w-4 text-violet-400" /> {t('en.presets')}
        </h3>
        {justSaved && (
          <span className="flex items-center gap-1 text-xs font-semibold text-emerald-300">
            <Check className="h-3.5 w-3.5" /> {t('en.presets.saved')}
          </span>
        )}
      </div>

      {naming ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave();
              if (e.key === 'Escape') setNaming(false);
            }}
            placeholder={t('en.presets.name')}
            maxLength={40}
            aria-label={t('en.presets.name')}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={onSave} className="flex-1 bg-violet-600 text-white hover:bg-violet-500 sm:flex-none">
              {t('en.presets.save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setNaming(false)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full border-white/15 bg-white/5 hover:bg-white/10"
          onClick={() => {
            refreshPresets();
            setNaming(true);
          }}
        >
          <BookmarkPlus className="mr-1.5 h-4 w-4 text-violet-300" /> {t('en.presets.save')}
        </Button>
      )}

      {presets.length > 0 ? (
        <ul className="pretty-scroll mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">
          {presets.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {p.filters.colorMode} · ink {p.filters.inkSaver}% · {p.layout.rows}×{p.layout.cols}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                onClick={() => applyPreset(p.id)}
              >
                {t('en.presets.apply')}
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`${t('up.remove')} ${p.name}`}
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-red-400"
                onClick={() => deletePreset(p.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        !naming && (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t('en.presets.none')}</p>
        )
      )}

      {/* Share / Import — swap recipe files with classmates */}
      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={presets.length === 0}
          onClick={onExport}
          className="h-8 flex-1 border-white/15 bg-white/5 text-xs hover:bg-white/10"
        >
          <Share2 className="mr-1.5 h-3.5 w-3.5 text-violet-300" /> {t('en.presets.share')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => importRef.current?.click()}
          className="h-8 flex-1 border-white/15 bg-white/5 text-xs hover:bg-white/10"
        >
          <Upload className="mr-1.5 h-3.5 w-3.5 text-violet-300" /> {t('en.presets.import')}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{t('en.presets.shareNote')}</p>
      {importMsg && (
        <p
          role="status"
          className={`mt-1.5 text-xs font-semibold ${importMsg.startsWith(t('en.presets.importFail').slice(0, 8)) ? 'text-red-300' : 'text-emerald-300'}`}
        >
          {importMsg}
        </p>
      )}
      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          void onImportFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
