import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Pencil,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Table2,
  Terminal,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import {
  BatchExtractionResult,
  ExtractedObject,
  OutputViewMode,
} from '../types/su53';
import {
  buildCriticalSet,
  filterExtractedObjects,
  formatPlainSU53Output,
  isCriticalToken,
  projectObjectsForUser,
  UNIDENTIFIED_USER,
} from '../utils/su53Parser';

type EditingCellState =
  | { kind: 'object'; objectName: string; draft: string }
  | { kind: 'field'; objectName: string; fieldName: string; draft: string }
  | { kind: 'values'; objectName: string; fieldName: string; draft: string }
  | { kind: 'users'; objectName: string; draft: string };

interface ResultWorkspaceProps {
  result: BatchExtractionResult | null;
  criticalItems: string[];
  selectedUser: string;
  filterQuery: string;
  onlyCritical: boolean;
  viewMode: OutputViewMode;
  hasManualEdits: boolean;
  onSelectedUserChange: (user: string) => void;
  onFilterQueryChange: (val: string) => void;
  onToggleOnlyCritical: () => void;
  onViewModeChange: (mode: OutputViewMode) => void;
  onCopy: (plainText: string) => void;
  onDownload: (plainText: string) => void;
  onExportExcel: (filteredObjects: ExtractedObject[]) => void;
  onOpenCriticalRules: () => void;
  onUpdateObjectName: (oldName: string, newName: string) => void;
  onUpdateObjectUsers: (objectName: string, newUsers: string[]) => void;
  onUpdateFieldName: (objectName: string, oldFieldName: string, newFieldName: string) => void;
  onUpdateFieldValues: (objectName: string, fieldName: string, newValues: string[]) => void;
  onDeleteField: (objectName: string, fieldName: string) => void;
  onApplyConsoleEdit: (plainText: string, scopedUser: string) => void;
}

export function ResultWorkspace({
  result,
  criticalItems,
  selectedUser,
  filterQuery,
  onlyCritical,
  viewMode,
  hasManualEdits,
  onSelectedUserChange,
  onFilterQueryChange,
  onToggleOnlyCritical,
  onViewModeChange,
  onCopy,
  onDownload,
  onExportExcel,
  onOpenCriticalRules,
  onUpdateObjectName,
  onUpdateObjectUsers,
  onUpdateFieldName,
  onUpdateFieldValues,
  onDeleteField,
  onApplyConsoleEdit,
}: ResultWorkspaceProps) {
  const [editingCell, setEditingCell] = useState<EditingCellState | null>(null);
  const [isConsoleEditing, setIsConsoleEditing] = useState(false);
  const [consoleDraft, setConsoleDraft] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);
  const consoleTextareaRef = useRef<HTMLTextAreaElement>(null);

  const editingKey = editingCell
    ? `${editingCell.kind}:${editingCell.objectName}:${'fieldName' in editingCell ? editingCell.fieldName : ''}`
    : null;

  // Foca e seleciona APENAS uma vez ao abrir o modo de edição (nunca a cada tecla digitada)
  useEffect(() => {
    if (editingKey && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingKey]);

  useEffect(() => {
    if (isConsoleEditing && consoleTextareaRef.current) {
      consoleTextareaRef.current.focus();
    }
  }, [isConsoleEditing]);

  // Cancela edição caso um novo resultado de extração seja carregado
  useEffect(() => {
    setEditingCell(null);
    setIsConsoleEditing(false);
  }, [result?.metadata.fileCount, result?.metadata.rowCount]);

  useEffect(() => {
    if (viewMode !== 'console') {
      setIsConsoleEditing(false);
    }
  }, [viewMode]);

  if (!result) {
    return (
      <section
        id="resumo"
        aria-labelledby="painel-diagnostico-heading"
        className="bg-white rounded-2xl border border-slate-200/90 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden"
      >
        {/* Cabeçalho do Painel 02 */}
        <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <span
              aria-hidden="true"
              className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 text-slate-600 font-mono text-xs font-bold flex items-center justify-center shrink-0"
            >
              02
            </span>
            <div>
              <h2
                id="painel-diagnostico-heading"
                className="text-base sm:text-lg font-semibold text-slate-900"
              >
                Painel de Consolidação &amp; Diagnóstico
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
                Visão consolidada por objeto de autorização, usuário, campos críticos e exportação em planilha.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenCriticalRules}
            className="min-h-[36px] px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
            <span>Regras Críticas ({criticalItems.length})</span>
          </button>
        </div>

        {/* Estado Vazio */}
        <div className="px-6 py-10 sm:py-12 text-center space-y-6">
          <div className="max-w-lg mx-auto space-y-3">
            <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200/90 text-slate-400 flex items-center justify-center mx-auto shadow-2xs">
              <FileText className="w-6 h-6" aria-hidden="true" />
            </div>
            <h3 className="text-base font-semibold text-slate-900">
              Nenhum log consolidado ainda
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
              Carregue relatórios HTML, PDFs ou prints da transação{' '}
              <span className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-xs">
                SU53
              </span>{' '}
              e clique em{' '}
              <strong className="font-semibold text-slate-700">Executar Extração</strong> para
              agrupar objetos, separar por usuário e identificar autorizações críticas.
            </p>
          </div>

          {/* Faixa de Prontidão */}
          <div className="max-w-3xl mx-auto border border-slate-200 rounded-xl bg-slate-50/60 grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 text-left">
            <div className="p-4">
              <span className="text-xs font-medium text-slate-600 block">Objetos Únicos</span>
              <span className="text-xs font-mono tabular-nums text-slate-400 mt-1.5 block">
                -- · aguardando entrada
              </span>
            </div>
            <div className="p-4">
              <span className="text-xs font-medium text-slate-600 block">Auditoria Crítica</span>
              <span className="text-xs font-mono tabular-nums text-slate-400 mt-1.5 block">
                -- · {criticalItems.length} regras ativas
              </span>
            </div>
            <div className="p-4">
              <span className="text-xs font-medium text-slate-600 block">Separação por Usuário</span>
              <span className="text-xs font-mono tabular-nums text-slate-400 mt-1.5 block">
                -- · aguardando entrada
              </span>
            </div>
          </div>

          <p className="text-xs text-slate-500 inline-flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            <span>
              Privacidade garantida: o processamento HTML, PDF e OCR é feito localmente no navegador sem envio a servidores externos.
            </span>
          </p>
        </div>
      </section>
    );
  }

  const criticalSet = buildCriticalSet(criticalItems);
  const availableUsers = Array.from(
    new Set([
      ...(Array.isArray(result.metadata.users) ? result.metadata.users : []),
      ...result.objects.flatMap((o) => (Array.isArray(o.users) ? o.users : [])),
    ])
  ).filter(Boolean);

  const effectiveSelectedUser =
    selectedUser !== 'ALL' && availableUsers.includes(selectedUser)
      ? selectedUser
      : 'ALL';

  const userScopedObjects = projectObjectsForUser(
    result.objects,
    effectiveSelectedUser,
    criticalSet
  );
  const filteredObjects: ExtractedObject[] = filterExtractedObjects(
    userScopedObjects,
    filterQuery,
    onlyCritical
  );
  const plainOutput = formatPlainSU53Output(filteredObjects);

  const scopedCriticals = Array.from(
    new Set(
      userScopedObjects.flatMap((obj) => {
        const list: string[] = [];
        if (isCriticalToken(obj.name, criticalSet)) list.push(obj.name.toUpperCase());
        obj.fields.forEach((f) =>
          f.values.forEach((v) => {
            if (isCriticalToken(v, criticalSet)) list.push(v.trim().toUpperCase());
          })
        );
        return list;
      })
    )
  );

  const handleChipClick = (objName: string) => {
    const normalized = filterQuery.trim().toUpperCase();
    if (onlyCritical) onToggleOnlyCritical();
    onFilterQueryChange(normalized === objName ? '' : objName);
  };

  const handleCriticalTokenClick = (token: string) => {
    const normalized = filterQuery.trim().toUpperCase();
    if (onlyCritical) onToggleOnlyCritical();
    onFilterQueryChange(normalized === token ? '' : token);
  };

  const commitEdit = () => {
    if (!editingCell) return;
    if (editingCell.kind === 'object') {
      const cleaned = editingCell.draft.trim().toUpperCase();
      if (cleaned && cleaned !== editingCell.objectName) {
        onUpdateObjectName(editingCell.objectName, cleaned);
      }
    } else if (editingCell.kind === 'field') {
      const cleaned = editingCell.draft.trim().toUpperCase();
      if (cleaned && cleaned !== editingCell.fieldName) {
        onUpdateFieldName(editingCell.objectName, editingCell.fieldName, cleaned);
      }
    } else if (editingCell.kind === 'values') {
      const parsedVals = Array.from(
        new Set(
          editingCell.draft
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        )
      );
      onUpdateFieldValues(editingCell.objectName, editingCell.fieldName, parsedVals);
    } else if (editingCell.kind === 'users') {
      const parsedUsers = Array.from(
        new Set(
          editingCell.draft
            .split(',')
            .map((u) => u.trim().toUpperCase())
            .filter(Boolean)
        )
      );
      onUpdateObjectUsers(
        editingCell.objectName,
        parsedUsers.length > 0 ? parsedUsers : [UNIDENTIFIED_USER]
      );
    }
    setEditingCell(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setEditingCell(null);
    }
  };

  const identifiedUsersCount = availableUsers.filter(
    (u) => u !== UNIDENTIFIED_USER
  ).length;

  return (
    <div className="space-y-6">
      {/* Metadados e Resumo do Lote */}
      <section id="resumo" aria-labelledby="resumo-heading">
        <h2 id="resumo-heading" className="sr-only">
          Resumo do Lote Extraído
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <span className="text-xs font-medium text-slate-500 block">
              {identifiedUsersCount > 1
                ? `Usuários (${identifiedUsersCount})`
                : 'Usuário(s)'}
            </span>
            <span
              className="text-sm sm:text-base font-bold text-slate-900 font-mono mt-1.5 block truncate"
              title={result.metadata.user}
            >
              {effectiveSelectedUser !== 'ALL'
                ? effectiveSelectedUser
                : result.metadata.user}
            </span>
          </div>
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <span className="text-xs font-medium text-slate-500 block">Sistema / Mandante</span>
            <span
              className="text-sm sm:text-base font-bold text-slate-900 font-mono mt-1.5 block truncate"
              title={result.metadata.sys}
            >
              {result.metadata.sys}
            </span>
          </div>
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <span className="text-xs font-medium text-slate-500 block">Objetos Únicos</span>
            <span className="text-sm sm:text-base font-bold text-sap-600 font-mono tabular-nums mt-1.5 block">
              {userScopedObjects.length}
            </span>
          </div>
          <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
            <span className="text-xs font-medium text-slate-500 block">Arquivos / Linhas</span>
            <span className="text-sm sm:text-base font-bold text-slate-900 font-mono tabular-nums mt-1.5 block">
              {result.metadata.rowLabel}
            </span>
          </div>
        </div>
      </section>

      {/* 02. Painel de Consolidação & Diagnóstico */}
      <section
        id="log-consolidado"
        aria-labelledby="log-consolidado-heading"
        className="bg-white rounded-2xl border border-slate-200/90 shadow-[0_1px_3px_rgba(15,23,42,0.04)] overflow-hidden flex flex-col"
      >
        {/* Cabeçalho do Resultado */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <span
              aria-hidden="true"
              className="w-9 h-9 rounded-lg bg-sap-500 text-white font-mono text-xs font-bold flex items-center justify-center shrink-0 shadow-xs"
            >
              02
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="log-consolidado-heading" className="text-base sm:text-lg font-semibold text-slate-900">
                  Painel de Consolidação &amp; Diagnóstico
                </h2>
                {hasManualEdits && (
                  <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold">
                    Editado manualmente
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Agrupado por Objeto e Campo sem duplicidades.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* Alternador de visualização: Console ou Tabela */}
            <div
              role="tablist"
              aria-label="Modo de visualização do log"
              className="inline-flex items-center p-1 bg-slate-200/70 rounded-lg mr-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'console'}
                onClick={() => onViewModeChange('console')}
                className={`min-h-[32px] px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  viewMode === 'console'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Terminal className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Console</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'table'}
                onClick={() => onViewModeChange('table')}
                className={`min-h-[32px] px-3 py-1 text-xs font-medium rounded-md transition-colors duration-150 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                  viewMode === 'table'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Tabela</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onOpenCriticalRules}
              title="Configurar lista de objetos e transações críticas"
              className="min-h-[40px] px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg transition-colors duration-150 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <span>Regras ({criticalItems.length})</span>
            </button>

            <button
              type="button"
              onClick={() => onDownload(isConsoleEditing ? consoleDraft : plainOutput)}
              disabled={!(isConsoleEditing ? consoleDraft : plainOutput)}
              className="min-h-[40px] px-4 py-2 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg transition-colors duration-150 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Baixar .TXT</span>
            </button>

            <button
              type="button"
              onClick={() => onExportExcel(filteredObjects)}
              disabled={filteredObjects.length === 0}
              className="min-h-[40px] px-4 py-2 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-700 border border-slate-300 text-xs font-semibold rounded-lg transition-colors duration-150 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              <span>Exportar Excel</span>
            </button>

            <button
              type="button"
              onClick={() => onCopy(isConsoleEditing ? consoleDraft : plainOutput)}
              disabled={!(isConsoleEditing ? consoleDraft : plainOutput)}
              className="min-h-[40px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors duration-150 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-emerald-600"
            >
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Copiar Log</span>
            </button>
          </div>
        </div>

        {/* Barra de Filtro por Objeto / Valor + Seletor por Usuário */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 flex-1">
              <div className="relative flex-1 max-w-md">
                <Search
                  className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={filterQuery}
                  onChange={(e) => {
                    if (onlyCritical) onToggleOnlyCritical();
                    onFilterQueryChange(e.target.value);
                  }}
                  placeholder="Filtrar por objeto, valor ou usuário (ex: S_TCODE, ME29N)..."
                  aria-label="Filtrar objetos, valores ou usuários extraídos"
                  className="w-full min-h-[40px] pl-9 pr-9 py-2 text-xs sm:text-sm border border-slate-300 rounded-lg focus:outline-none focus:border-sap-500 focus:ring-2 focus:ring-sap-500/20 font-mono transition-colors"
                />
                {filterQuery && (
                  <button
                    type="button"
                    onClick={() => onFilterQueryChange('')}
                    aria-label="Limpar filtro de pesquisa"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {availableUsers.length >= 1 && (
                <div className="relative shrink-0">
                  <Users
                    className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <select
                    value={effectiveSelectedUser}
                    onChange={(e) => onSelectedUserChange(e.target.value)}
                    aria-label="Filtrar log consolidado por usuário"
                    className="min-h-[40px] pl-9 pr-8 py-2 text-xs sm:text-sm font-mono font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:border-sap-500 focus:ring-2 focus:ring-sap-500/20"
                  >
                    <option value="ALL">
                      {availableUsers.length > 1
                        ? `Todos os usuários (${availableUsers.length})`
                        : `Usuário: ${availableUsers[0]}`}
                    </option>
                    {availableUsers.map((user) => {
                      const count = result.objects.filter(
                        (o) => Array.isArray(o.users) && o.users.includes(user)
                      ).length;
                      return (
                        <option key={user} value={user}>
                          {user} ({count} obj.)
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </div>

            <div className="text-xs text-slate-500 font-medium tabular-nums">
              Exibindo{' '}
              <span className="font-bold text-sap-600">{filteredObjects.length}</span> de{' '}
              <span className="font-bold text-slate-700">{userScopedObjects.length}</span>{' '}
              objeto(s)
            </div>
          </div>

          {/* Filtro rápido por Usuário quando houver múltiplos usuários no lote */}
          {availableUsers.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] font-semibold text-slate-500 mr-1 inline-flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-sap-600" aria-hidden="true" />
                <span>Separar por Usuário:</span>
              </span>
              <button
                type="button"
                onClick={() => onSelectedUserChange('ALL')}
                className={`min-h-[30px] px-2.5 py-1 rounded-md text-xs font-mono font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  effectiveSelectedUser === 'ALL'
                    ? 'bg-slate-800 text-white border border-slate-800'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
                }`}
              >
                Todos ({result.objects.length})
              </button>
              {availableUsers.map((user) => {
                const count = result.objects.filter(
                  (o) => Array.isArray(o.users) && o.users.includes(user)
                ).length;
                const active = effectiveSelectedUser === user;
                return (
                  <button
                    key={user}
                    type="button"
                    onClick={() => onSelectedUserChange(active ? 'ALL' : user)}
                    className={`min-h-[30px] px-2.5 py-1 rounded-md text-xs font-mono font-semibold transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-sap-600 text-white border border-sap-600'
                        : 'bg-sap-50 hover:bg-sap-100 text-sap-800 border border-sap-200'
                    }`}
                  >
                    {user} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Botões de filtro rápido por Objeto */}
          <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-1">
            {userScopedObjects.map((obj) => {
              const isSelected = filterQuery.trim().toUpperCase() === obj.name;
              if (obj.hasCriticalContent) {
                return (
                  <button
                    key={obj.name}
                    type="button"
                    onClick={() => handleChipClick(obj.name)}
                    className={`min-h-[32px] px-2.5 py-1 rounded-md text-xs font-mono font-bold transition-colors duration-150 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 ${
                      isSelected
                        ? 'bg-red-600 text-white border border-red-600'
                        : 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-300'
                    }`}
                  >
                    <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>{obj.name}</span>
                  </button>
                );
              }

              return (
                <button
                  key={obj.name}
                  type="button"
                  onClick={() => handleChipClick(obj.name)}
                  className={`min-h-[32px] px-2.5 py-1 rounded-md text-xs font-mono font-medium transition-colors duration-150 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sap-500 ${
                    isSelected
                      ? 'bg-sap-500 text-white border border-sap-500'
                      : 'bg-slate-100 hover:bg-sap-50 text-slate-700 hover:text-sap-700 border border-slate-200'
                  }`}
                >
                  {obj.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Banner de Alerta de Itens Críticos */}
        {scopedCriticals.length > 0 && (
          <div
            role="alert"
            className="px-6 py-3.5 bg-red-50 border-b border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start sm:items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-red-100 border border-red-200 text-red-600 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-bold text-red-900">
                  Atenção: Objetos ou Valores Críticos Detectados ({scopedCriticals.length})
                </p>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {scopedCriticals.map((token) => {
                    const active = filterQuery.trim().toUpperCase() === token;
                    return (
                      <button
                        key={token}
                        type="button"
                        onClick={() => handleCriticalTokenClick(token)}
                        title={`Filtrar ocorrências de ${token}`}
                        className={`px-2 py-0.5 rounded text-xs font-mono font-bold border transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1 ${
                          active
                            ? 'bg-red-700 text-white border-red-700'
                            : 'bg-white hover:bg-red-100 text-red-800 border-red-300'
                        }`}
                      >
                        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span>{token}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onToggleOnlyCritical}
              className={`min-h-[38px] self-start sm:self-center shrink-0 px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors duration-150 inline-flex items-center gap-1.5 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 ${
                onlyCritical
                  ? 'bg-slate-800 hover:bg-slate-900 text-white'
                  : 'bg-red-600 hover:bg-red-700 text-white'
              }`}
            >
              <Filter className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{onlyCritical ? 'Mostrar Todos' : 'Filtrar Críticos'}</span>
            </button>
          </div>
        )}

        {/* Área Principal de Exibição */}
        {viewMode === 'console' ? (
          <div className="p-5 sm:p-6 bg-slate-900 space-y-3">
            {filteredObjects.length === 0 && !isConsoleEditing ? (
              <div className="min-h-[16rem] flex flex-col items-center justify-center text-center text-slate-400 font-mono text-xs sm:text-sm gap-2">
                <span>Nenhum objeto corresponde ao filtro informado.</span>
                <button
                  type="button"
                  onClick={() => {
                    onFilterQueryChange('');
                    onSelectedUserChange('ALL');
                    if (onlyCritical) onToggleOnlyCritical();
                  }}
                  className="text-sky-400 hover:text-sky-300 underline text-xs"
                >
                  Limpar filtros
                </button>
              </div>
            ) : isConsoleEditing ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                  <span className="text-[11px] font-mono text-slate-400">
                    Modo de edição livre no console · Ctrl+Enter aplica alterações · Esc cancela
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsConsoleEditing(false)}
                      className="min-h-[32px] px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold rounded-md transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onApplyConsoleEdit(consoleDraft, effectiveSelectedUser);
                        setIsConsoleEditing(false);
                      }}
                      className="min-h-[32px] px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-md transition-colors inline-flex items-center gap-1.5"
                    >
                      <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Aplicar alterações</span>
                    </button>
                  </div>
                </div>
                <textarea
                  ref={consoleTextareaRef}
                  value={consoleDraft}
                  onChange={(e) => setConsoleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                      e.preventDefault();
                      onApplyConsoleEdit(consoleDraft, effectiveSelectedUser);
                      setIsConsoleEditing(false);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setIsConsoleEditing(false);
                    }
                  }}
                  spellCheck={false}
                  aria-label="Editor de texto do log consolidado no modo console"
                  className="w-full min-h-[24rem] max-h-[38rem] overflow-auto bg-slate-950/70 text-slate-100 font-mono text-xs sm:text-sm leading-relaxed p-3.5 rounded-lg border border-slate-700 focus:outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/20 resize-y"
                />
              </>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
                  <span className="text-[11px] font-mono text-slate-400">
                    Clique no texto ou no botão ao lado para editar diretamente no console
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setConsoleDraft(plainOutput);
                      setIsConsoleEditing(true);
                    }}
                    className="min-h-[32px] px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold rounded-md transition-colors inline-flex items-center gap-1.5"
                  >
                    <Pencil className="w-3 h-3 text-sky-400" aria-hidden="true" />
                    <span>Editar texto</span>
                  </button>
                </div>
                <pre
                  onClick={() => {
                    const selected = window.getSelection()?.toString() ?? '';
                    if (!selected) {
                      setConsoleDraft(plainOutput);
                      setIsConsoleEditing(true);
                    }
                  }}
                  title="Clique para editar o texto no console"
                  className="w-full min-h-[24rem] max-h-[38rem] overflow-auto bg-transparent text-slate-100 font-mono text-xs sm:text-sm leading-relaxed whitespace-pre-wrap cursor-text"
                >
                  {filteredObjects.map((obj, idx) => (
                    <span key={obj.name}>
                      {idx > 0 && '\n\n'}
                      {obj.isCriticalName ? (
                        <span className="inline-flex items-center gap-1.5 bg-red-500/25 text-red-300 border border-red-500/50 px-2 py-0.5 rounded font-bold">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-400 inline shrink-0" />
                          {obj.name} [CRÍTICO]
                        </span>
                      ) : (
                        <span className="text-sky-300 font-bold">{obj.name}</span>
                      )}
                      {effectiveSelectedUser === 'ALL' &&
                        Array.isArray(obj.users) &&
                        obj.users.length > 0 &&
                        availableUsers.length > 1 && (
                          <span className="text-slate-400 text-xs">
                            {' '}
                            ({obj.users.join(', ')})
                          </span>
                        )}
                      {obj.fields.map((field) => (
                        <span key={field.name}>
                          {'\n  '}
                          <span className="text-slate-400">{field.name}:</span>{' '}
                          {field.values.length > 0 ? (
                            field.values.map((val, vIdx) => (
                              <span key={`${val}-${vIdx}`}>
                                {vIdx > 0 && <span className="text-slate-400">, </span>}
                                {isCriticalToken(val, criticalSet) ? (
                                  <span className="bg-red-500/30 text-red-200 border border-red-400/60 px-1.5 py-0.5 rounded font-bold">
                                    {val} [CRÍTICO]
                                  </span>
                                ) : (
                                  <span className="text-slate-100">{val}</span>
                                )}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-500 italic">(vazio)</span>
                          )}
                        </span>
                      ))}
                    </span>
                  ))}
                </pre>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {filteredObjects.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-500">
                Nenhum objeto corresponde ao filtro informado.
              </div>
            ) : (
              <>
                <div className="px-6 py-2.5 bg-slate-50/60 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                  <span className="inline-flex items-center gap-1.5">
                    <Pencil className="w-3 h-3 text-sap-600" aria-hidden="true" />
                    <span>
                      Revisão pós-OCR: clique em qualquer <strong>Objeto</strong>, <strong>Campo</strong>, <strong>Valor</strong> ou <strong>Usuário</strong> na tabela para corrigir antes de exportar (Enter salva · Esc cancela).
                    </span>
                  </span>
                </div>
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-6 w-14 text-right tabular-nums">#</th>
                      <th className="py-3 px-4">Objeto</th>
                      <th className="py-3 px-4">Campo</th>
                      <th className="py-3 px-4">Valores Consolidados</th>
                      <th className="py-3 px-4">Usuário(s)</th>
                      <th className="py-3 px-4 text-right">Classificação</th>
                      <th className="py-3 px-4 w-12 text-right">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-xs sm:text-sm">
                    {filteredObjects.flatMap((obj, objIdx) =>
                      obj.fields.map((field, fieldIdx) => {
                        const rowCritical =
                          obj.isCriticalName ||
                          field.values.some((v) => isCriticalToken(v, criticalSet));
                        const isEditingObj =
                          fieldIdx === 0 &&
                          editingCell?.kind === 'object' &&
                          editingCell.objectName === obj.name;
                        const isEditingField =
                          editingCell?.kind === 'field' &&
                          editingCell.objectName === obj.name &&
                          editingCell.fieldName === field.name;
                        const isEditingValues =
                          editingCell?.kind === 'values' &&
                          editingCell.objectName === obj.name &&
                          editingCell.fieldName === field.name;
                        const isEditingUsers =
                          fieldIdx === 0 &&
                          editingCell?.kind === 'users' &&
                          editingCell.objectName === obj.name;

                        const objUsersList = Array.isArray(obj.users) && obj.users.length > 0
                          ? obj.users
                          : [UNIDENTIFIED_USER];

                        return (
                          <tr
                            key={`${obj.name}-${field.name}`}
                            className="group hover:bg-slate-50/90 transition-colors"
                          >
                            <td className="py-3 px-6 text-right font-mono tabular-nums text-slate-400">
                              {fieldIdx === 0 ? objIdx + 1 : ''}
                            </td>

                            {/* Célula Objeto (editável no primeiro campo do bloco) */}
                            <td className="py-3 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                              {fieldIdx === 0 ? (
                                isEditingObj ? (
                                  <div className="inline-flex items-center gap-1">
                                    <input
                                      ref={editInputRef}
                                      type="text"
                                      value={editingCell.draft}
                                      onChange={(e) =>
                                        setEditingCell({
                                          ...editingCell,
                                          draft: e.target.value,
                                        })
                                      }
                                      onBlur={commitEdit}
                                      onKeyDown={handleEditKeyDown}
                                      aria-label={`Editar nome do objeto ${obj.name}`}
                                      className="w-56 sm:w-64 px-2.5 py-1 text-xs font-mono uppercase bg-white border border-sap-500 rounded focus:outline-none focus:ring-2 focus:ring-sap-500/20"
                                    />
                                    <button
                                      type="button"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={commitEdit}
                                      aria-label="Salvar nome do objeto"
                                      className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => setEditingCell(null)}
                                      aria-label="Cancelar edição"
                                      className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingCell({
                                        kind: 'object',
                                        objectName: obj.name,
                                        draft: obj.name,
                                      })
                                    }
                                    title="Clique para editar o nome do objeto"
                                    className="inline-flex items-center gap-1.5 text-left hover:text-sap-600 rounded px-1.5 -mx-1.5 py-0.5 hover:bg-sap-50/70 transition-colors"
                                  >
                                    <span>{obj.name}</span>
                                    <Pencil
                                      className="w-3 h-3 text-slate-300 group-hover:text-sap-500 shrink-0"
                                      aria-hidden="true"
                                    />
                                  </button>
                                )
                              ) : (
                                ''
                              )}
                            </td>

                            {/* Célula Campo (editável) */}
                            <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                              {isEditingField ? (
                                <div className="inline-flex items-center gap-1">
                                  <input
                                    ref={editInputRef}
                                    type="text"
                                    value={editingCell.draft}
                                    onChange={(e) =>
                                      setEditingCell({
                                        ...editingCell,
                                        draft: e.target.value,
                                      })
                                    }
                                    onBlur={commitEdit}
                                    onKeyDown={handleEditKeyDown}
                                    aria-label={`Editar nome do campo ${field.name}`}
                                    className="w-40 sm:w-48 px-2.5 py-1 text-xs font-mono uppercase bg-white border border-sap-500 rounded focus:outline-none focus:ring-2 focus:ring-sap-500/20"
                                  />
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={commitEdit}
                                    aria-label="Salvar nome do campo"
                                    className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setEditingCell(null)}
                                    aria-label="Cancelar edição"
                                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingCell({
                                      kind: 'field',
                                      objectName: obj.name,
                                      fieldName: field.name,
                                      draft: field.name,
                                    })
                                  }
                                  title="Clique para editar o nome do campo"
                                  className="inline-flex items-center gap-1.5 text-left hover:text-sap-600 rounded px-1.5 -mx-1.5 py-0.5 hover:bg-sap-50/70 transition-colors"
                                >
                                  <span>{field.name}</span>
                                  <Pencil
                                    className="w-3 h-3 text-slate-300 group-hover:text-sap-500 shrink-0"
                                    aria-hidden="true"
                                  />
                                </button>
                              )}
                            </td>

                            {/* Célula Valores Consolidados (editável) */}
                            <td className="py-3 px-4 font-mono">
                              {isEditingValues ? (
                                <div className="flex items-center gap-1 min-w-[16rem] sm:min-w-[22rem]">
                                  <input
                                    ref={editInputRef}
                                    type="text"
                                    value={editingCell.draft}
                                    onChange={(e) =>
                                      setEditingCell({
                                        ...editingCell,
                                        draft: e.target.value,
                                      })
                                    }
                                    onBlur={commitEdit}
                                    onKeyDown={handleEditKeyDown}
                                    placeholder="Separe múltiplos valores por vírgula"
                                    aria-label={`Editar valores do campo ${field.name}`}
                                    className="flex-1 min-w-[14rem] px-2.5 py-1 text-xs font-mono bg-white border border-sap-500 rounded focus:outline-none focus:ring-2 focus:ring-sap-500/20"
                                  />
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={commitEdit}
                                    aria-label="Salvar valores"
                                    className="p-1 text-emerald-600 hover:bg-emerald-50 rounded shrink-0"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => setEditingCell(null)}
                                    aria-label="Cancelar edição"
                                    className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded shrink-0"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setEditingCell({
                                      kind: 'values',
                                      objectName: obj.name,
                                      fieldName: field.name,
                                      draft: field.values.join(', '),
                                    })
                                  }
                                  title="Clique para editar ou corrigir valores (separe por vírgula)"
                                  className="w-full text-left rounded px-1.5 -mx-1.5 py-0.5 hover:bg-sap-50/70 transition-colors inline-flex items-center justify-between gap-2"
                                >
                                  {field.values.length > 0 ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      {field.values.map((val, vIdx) =>
                                        isCriticalToken(val, criticalSet) ? (
                                          <span
                                            key={`${val}-${vIdx}`}
                                            className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 font-bold"
                                          >
                                            {val}
                                          </span>
                                        ) : (
                                          <span key={`${val}-${vIdx}`} className="text-slate-800">
                                            {val}
                                            {vIdx < field.values.length - 1 ? ',' : ''}
                                          </span>
                                        )
                                      )}
                                    </div>
                                  ) : (
                                    <span className="text-slate-400 italic">(vazio)</span>
                                  )}
                                  <Pencil
                                    className="w-3 h-3 text-slate-300 group-hover:text-sap-500 shrink-0"
                                    aria-hidden="true"
                                  />
                                </button>
                              )}
                            </td>

                            {/* Célula Usuário(s) (editável no primeiro campo do bloco) */}
                            <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                              {fieldIdx === 0 ? (
                                isEditingUsers ? (
                                  <div className="inline-flex items-center gap-1">
                                    <input
                                      ref={editInputRef}
                                      type="text"
                                      value={editingCell.draft}
                                      onChange={(e) =>
                                        setEditingCell({
                                          ...editingCell,
                                          draft: e.target.value,
                                        })
                                      }
                                      onBlur={commitEdit}
                                      onKeyDown={handleEditKeyDown}
                                      placeholder="Ex: JOAO.SILVA, MARIA.S"
                                      aria-label={`Editar usuários do objeto ${obj.name}`}
                                      className="w-48 px-2.5 py-1 text-xs font-mono uppercase bg-white border border-sap-500 rounded focus:outline-none focus:ring-2 focus:ring-sap-500/20"
                                    />
                                    <button
                                      type="button"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={commitEdit}
                                      aria-label="Salvar usuários"
                                      className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onMouseDown={(e) => e.preventDefault()}
                                      onClick={() => setEditingCell(null)}
                                      aria-label="Cancelar edição"
                                      className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingCell({
                                        kind: 'users',
                                        objectName: obj.name,
                                        draft:
                                          objUsersList[0] === UNIDENTIFIED_USER &&
                                          objUsersList.length === 1
                                            ? ''
                                            : objUsersList.join(', '),
                                      })
                                    }
                                    title="Clique para editar ou atribuir usuário(s) (separe por vírgula)"
                                    className="inline-flex items-center gap-1.5 text-left rounded px-1.5 -mx-1.5 py-0.5 hover:bg-sap-50/70 transition-colors"
                                  >
                                    <div className="flex flex-wrap gap-1">
                                      {objUsersList.map((u) => (
                                        <span
                                          key={u}
                                          className={`px-1.5 py-0.5 rounded border text-[11px] ${
                                            u === UNIDENTIFIED_USER
                                              ? 'bg-slate-50 border-slate-200 text-slate-400 italic'
                                              : 'bg-slate-100 border-slate-200 text-slate-700'
                                          }`}
                                        >
                                          {u}
                                        </span>
                                      ))}
                                    </div>
                                    <Pencil
                                      className="w-3 h-3 text-slate-300 group-hover:text-sap-500 shrink-0"
                                      aria-hidden="true"
                                    />
                                  </button>
                                )
                              ) : (
                                ''
                              )}
                            </td>

                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              {rowCritical ? (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Crítico</span>
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                                  <span>Padrão</span>
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => onDeleteField(obj.name, field.name)}
                                title={`Remover linha ${obj.name} · ${field.name}`}
                                aria-label={`Remover linha ${obj.name} campo ${field.name}`}
                                className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
