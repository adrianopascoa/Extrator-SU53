import * as XLSX from 'xlsx';
import { BatchExtractionMetadata, ExtractedObject } from '../types/su53';
import { buildCriticalSet, isCriticalToken } from './su53Parser';

export function buildAndDownloadSU53Excel(
  filteredObjects: ExtractedObject[],
  metadata: BatchExtractionMetadata,
  detectedCriticals: string[],
  downloadName: string,
  criticalItems?: string[],
  selectedUser = 'ALL'
): void {
  if (filteredObjects.length === 0) return;

  const criticalSet = buildCriticalSet(criticalItems);
  const workbook = XLSX.utils.book_new();

  // Aba 1: Log Consolidado (estrutura tabular pronta para filtros e tabela dinâmica)
  const consolidatedRows: Array<Record<string, string | number>> = [];

  filteredObjects.forEach((obj) => {
    const rowUserLabel =
      selectedUser !== 'ALL'
        ? selectedUser
        : Array.isArray(obj.users) && obj.users.length > 0
        ? obj.users.join(', ')
        : metadata.user;

    if (obj.fields.length === 0) {
      consolidatedRows.push({
        Objeto: obj.name,
        Campo: '(sem campos)',
        'Valores Consolidados': '(vazio)',
        'Qtd. Valores': 0,
        Classificação: obj.isCriticalName ? 'Crítico' : 'Padrão',
        'Usuário(s)': rowUserLabel,
        'Sistema / Mandante': metadata.sys,
      });
      return;
    }

    obj.fields.forEach((field) => {
      const hasCriticalValue = field.values.some((v) =>
        isCriticalToken(v, criticalSet)
      );
      const rowCritical = obj.isCriticalName || hasCriticalValue;

      consolidatedRows.push({
        Objeto: obj.name,
        Campo: field.name,
        'Valores Consolidados':
          field.values.length > 0 ? field.values.join(', ') : '(vazio)',
        'Qtd. Valores': field.values.length,
        Classificação: rowCritical ? 'Crítico' : 'Padrão',
        'Usuário(s)': rowUserLabel,
        'Sistema / Mandante': metadata.sys,
      });
    });
  });

  const mainSheet = XLSX.utils.json_to_sheet(consolidatedRows);
  mainSheet['!cols'] = [
    { wch: 24 }, // Objeto
    { wch: 20 }, // Campo
    { wch: 48 }, // Valores Consolidados
    { wch: 14 }, // Qtd. Valores
    { wch: 16 }, // Classificação
    { wch: 24 }, // Usuário(s)
    { wch: 22 }, // Sistema / Mandante
  ];

  if (consolidatedRows.length > 0) {
    mainSheet['!autofilter'] = {
      ref: `A1:G${consolidatedRows.length + 1}`,
    };
  }

  XLSX.utils.book_append_sheet(workbook, mainSheet, 'Log Consolidado');

  // Aba 2 (condicional): Detalhamento separado por Usuário quando há múltiplos usuários no lote
  const distinctUsersInExport = Array.from(
    new Set(
      filteredObjects.flatMap((o) => (Array.isArray(o.users) ? o.users : []))
    )
  );

  if (selectedUser === 'ALL' && distinctUsersInExport.length > 1) {
    const perUserRows: Array<Record<string, string | number>> = [];

    distinctUsersInExport.forEach((user) => {
      filteredObjects.forEach((obj) => {
        if (!Array.isArray(obj.users) || !obj.users.includes(user)) return;

        obj.fields.forEach((field) => {
          const userValues =
            field.valuesByUser &&
            Object.prototype.hasOwnProperty.call(field.valuesByUser, user)
              ? field.valuesByUser[user]
              : field.valuesByUser
              ? null
              : field.values;

          if (userValues === null) return;

          const hasCritVal = userValues.some((v) =>
            isCriticalToken(v, criticalSet)
          );
          perUserRows.push({
            Usuário: user,
            'Sistema / Mandante': metadata.sys,
            Objeto: obj.name,
            Campo: field.name,
            Valores: userValues.length > 0 ? userValues.join(', ') : '(vazio)',
            'Qtd. Valores': userValues.length,
            Classificação:
              obj.isCriticalName || hasCritVal ? 'Crítico' : 'Padrão',
          });
        });
      });
    });

    if (perUserRows.length > 0) {
      const perUserSheet = XLSX.utils.json_to_sheet(perUserRows);
      perUserSheet['!cols'] = [
        { wch: 22 }, // Usuário
        { wch: 20 }, // Sistema / Mandante
        { wch: 24 }, // Objeto
        { wch: 20 }, // Campo
        { wch: 46 }, // Valores
        { wch: 14 }, // Qtd. Valores
        { wch: 16 }, // Classificação
      ];
      perUserSheet['!autofilter'] = {
        ref: `A1:G${perUserRows.length + 1}`,
      };
      XLSX.utils.book_append_sheet(workbook, perUserSheet, 'Por Usuário');
    }
  }

  // Aba Final: Resumo Executivo da Extração
  const summaryRows = [
    {
      Métrica: 'Usuário(s) Exportado(s)',
      Valor: selectedUser !== 'ALL' ? selectedUser : metadata.user,
    },
    { Métrica: 'Sistema / Mandante', Valor: metadata.sys },
    { Métrica: 'Arquivos Processados', Valor: metadata.fileCount },
    { Métrica: 'Linhas Analisadas', Valor: metadata.rowCount },
    { Métrica: 'Objetos Únicos (Total)', Valor: metadata.objectCount },
    { Métrica: 'Objetos Exportados', Valor: filteredObjects.length },
    {
      Métrica: 'Itens Críticos Detectados',
      Valor:
        detectedCriticals.length > 0 ? detectedCriticals.join(', ') : 'Nenhum',
    },
    {
      Métrica: 'Exportado em',
      Valor: new Date().toLocaleString('pt-BR'),
    },
  ];

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
  summarySheet['!cols'] = [{ wch: 28 }, { wch: 52 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumo');

  const arrayBuffer = XLSX.write(workbook, {
    bookType: 'xlsx',
    type: 'array',
  }) as ArrayBuffer;

  const blob = new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = downloadName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
