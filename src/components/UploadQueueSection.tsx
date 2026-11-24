import React, { useRef, useState } from 'react';
import {
  CloudUpload,
  FileCode2,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { LoadedFile } from '../types/su53';
import { formatBytes } from '../utils/su53Parser';

interface UploadQueueSectionProps {
  loadedFiles: LoadedFile[];
  isProcessing: boolean;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveFile: (id: string) => void;
  onClearAll: () => void;
  onExecute: () => void;
}

export function UploadQueueSection({
  loadedFiles,
  isProcessing,
  onAddFiles,
  onRemoveFile,
  onClearAll,
  onExecute,
}: UploadQueueSectionProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const totalSize = loadedFiles.reduce((acc, f) => acc + f.size, 0);
  const htmlCount = loadedFiles.filter((f) => f.kind === 'html').length;
  const imageCount = loadedFiles.filter((f) => f.kind === 'image').length;
  const pdfCount = loadedFiles.filter((f) => f.kind === 'pdf').length;

  const openFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAddFiles(e.dataTransfer.files);
    }
  };

  const handleZoneKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openFilePicker();
    }
  };

  const summaryParts: string[] = [formatBytes(totalSize) + ' no total'];
  if (htmlCount > 0) {
    summaryParts.push(`${htmlCount} ${htmlCount === 1 ? 'HTML' : 'HTMLs'}`);
  }
  if (imageCount > 0) {
    summaryParts.push(`${imageCount} ${imageCount === 1 ? 'imagem' : 'imagens'}`);
  }
  if (pdfCount > 0) {
    summaryParts.push(`${pdfCount} ${pdfCount === 1 ? 'PDF' : 'PDFs'}`);
  }

  return (
    <section
      id="importacao"
      aria-labelledby="importacao-heading"
      className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-[0_1px_3px_rgba(15,23,42,0.04)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] overflow-hidden transition-colors duration-200"
    >
      {/* Linha superior sutil de acento corporativo */}
      <div
        aria-hidden="true"
        className="h-[3px] w-full bg-gradient-to-r from-sap-600 via-sap-500 to-sky-400"
      />

      <div className="p-6 sm:p-7">
        {/* Cabeçalho da Seção 01 */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div className="flex items-start gap-3.5">
            <span
              aria-hidden="true"
              className="w-9 h-9 rounded-lg bg-sap-500 text-white font-mono text-xs font-bold flex items-center justify-center shrink-0 shadow-xs"
            >
              01
            </span>
            <div>
              <h2
                id="importacao-heading"
                className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100 flex flex-wrap items-baseline gap-x-2"
              >
                <span>Seleção de Arquivos da SU53</span>
                <span className="text-xs font-normal text-slate-400 dark:text-slate-500">(HTML, Imagem ou PDF)</span>
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Importe os dados brutos de falhas de autorização para unificação e tratamento de perfis SAP.
              </p>
            </div>
          </div>

          <div className="self-start lg:self-center inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-500 dark:text-slate-400 shrink-0">
            <span>Atalho rápido:</span>
            <kbd className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 shadow-2xs">
              Ctrl
            </kbd>
            <span>+</span>
            <kbd className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-1.5 py-0.5 shadow-2xs">
              V
            </kbd>
            <span>para colar print</span>
          </div>
        </div>

        {/* Zona de Drag & Drop */}
        <div
          role="button"
          tabIndex={0}
          onClick={openFilePicker}
          onKeyDown={handleZoneKeyDown}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          aria-label="Selecionar ou arrastar arquivos HTML, PDF ou imagens da transação SAP SU53"
          className={`group border-2 border-dashed rounded-xl px-6 py-9 sm:py-10 text-center cursor-pointer transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500 ${
            isDragging
              ? 'border-sap-500 bg-sap-50/70 dark:bg-sap-900/40'
              : 'border-slate-300/90 dark:border-slate-700 hover:border-sap-500 dark:hover:border-sky-500 bg-slate-50/50 dark:bg-slate-950/50 hover:bg-sap-50/30 dark:hover:bg-slate-800/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".html,.htm,.pdf,application/pdf,image/png,image/jpeg,image/webp,image/bmp,image/gif"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                onAddFiles(e.target.files);
              }
            }}
          />

          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-12 h-12 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-xs flex items-center justify-center text-sap-500 dark:text-sky-400">
              <CloudUpload className="w-6 h-6" aria-hidden="true" />
            </div>

            <div className="space-y-1">
              <p className="text-sm sm:text-base font-medium text-slate-800 dark:text-slate-200">
                <span className="text-sap-600 dark:text-sky-400 font-semibold">Clique para selecionar</span> ou arraste seus arquivos aqui
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto leading-relaxed">
                Arraste relatórios exportados do SAP GUI, PDFs de chamados ou cole uma captura de tela (
                <span className="font-mono text-slate-700 dark:text-slate-200">Ctrl+V</span>) diretamente da área de transferência.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <span className="min-h-[40px] px-4 py-2 bg-sap-500 group-hover:bg-sap-600 text-white text-xs sm:text-sm font-semibold rounded-lg shadow-xs opacity-80 group-hover:opacity-100 group-hover:-translate-y-0.5 group-hover:shadow-[0_6px_16px_-4px_rgba(0,112,242,0.3)] inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-all duration-200">
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Selecionar Arquivos</span>
              </span>

              <span className="hidden sm:inline-block h-5 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />

              <span className="text-xs font-mono text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                <span>.HTML / .HTM</span>
                <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
                <span>.PDF</span>
                <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>
                <span>.PNG, .JPG, .WEBP (Print OCR)</span>
              </span>
            </div>
          </div>
        </div>

        {/* Fila de arquivos carregados */}
        {loadedFiles.length > 0 && (
          <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-sap-50 dark:bg-sky-950/60 border border-sap-100 dark:border-sky-800/60 flex items-center justify-center text-sap-600 dark:text-sky-400 shrink-0">
                  <Layers className="w-5 h-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                    {loadedFiles.length === 1
                      ? loadedFiles[0].name
                      : `${loadedFiles.length} arquivos na fila para consolidação`}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                    {summaryParts.join(' · ')}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={openFilePicker}
                  disabled={isProcessing}
                  className="min-h-[40px] px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 border border-slate-300 dark:border-slate-700 rounded-lg transition-colors duration-150 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Adicionar</span>
                </button>
                <button
                  type="button"
                  onClick={onClearAll}
                  disabled={isProcessing}
                  className="min-h-[40px] px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-red-700 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 disabled:opacity-50 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors duration-150 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                  <span>Limpar</span>
                </button>
                <button
                  type="button"
                  onClick={onExecute}
                  disabled={isProcessing}
                  className="min-h-[40px] px-5 py-2 bg-sap-500 hover:bg-sap-600 active:bg-sap-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow-xs transition-colors duration-150 inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sap-500 dark:focus-visible:ring-offset-slate-900"
                >
                  {isProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="w-4 h-4 fill-current" aria-hidden="true" />
                  )}
                  <span>
                    {isProcessing
                      ? imageCount > 0 || pdfCount > 0
                        ? 'Extraindo localmente...'
                        : 'Processando...'
                      : loadedFiles.length > 1
                      ? 'Consolidar Lote'
                      : 'Executar Extração'}
                  </span>
                </button>
              </div>
            </div>

            {/* Grade compacta de arquivos na fila */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-52 overflow-y-auto pr-1">
              {loadedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between gap-2 bg-slate-50/80 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 px-3 py-2.5 rounded-xl text-xs text-slate-700 dark:text-slate-200"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {file.kind === 'image' && file.previewUrl ? (
                      <img
                        src={file.previewUrl}
                        alt={`Pré-visualização de ${file.name}`}
                        referrerPolicy="no-referrer"
                        className="w-8 h-8 rounded-md object-cover border border-slate-300 dark:border-slate-600 shrink-0 bg-white dark:bg-slate-900"
                      />
                    ) : file.kind === 'image' ? (
                      <ImageIcon className="w-4 h-4 text-sap-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
                    ) : file.kind === 'pdf' ? (
                      <FileText className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" aria-hidden="true" />
                    ) : (
                      <FileCode2 className="w-4 h-4 text-sap-600 dark:text-sky-400 shrink-0" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <span className="font-medium truncate block text-slate-800 dark:text-slate-100" title={file.name}>
                        {file.name}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {file.kind === 'image' ? 'Imagem' : file.kind === 'pdf' ? 'PDF' : 'HTML'} ·{' '}
                        {formatBytes(file.size, 1)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveFile(file.id)}
                    disabled={isProcessing}
                    aria-label={`Remover ${file.name} da fila`}
                    className="p-1.5 rounded-lg text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/50 disabled:opacity-40 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
