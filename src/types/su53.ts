export type LoadedFileKind = 'html' | 'image' | 'pdf';

export interface LoadedFile {
  id: string;
  name: string;
  size: number;
  kind: LoadedFileKind;
  content?: string;
  mimeType?: string;
  base64?: string;
  previewUrl?: string;
  pdfData?: ArrayBuffer;
}

export interface ExtractedField {
  name: string;
  values: string[];
  valuesByUser?: Record<string, string[]>;
}

export interface ExtractedObject {
  name: string;
  fields: ExtractedField[];
  users: string[];
  isCriticalName: boolean;
  hasCriticalContent: boolean;
}

export interface BatchExtractionMetadata {
  user: string;
  users: string[];
  sys: string;
  objectCount: number;
  fileCount: number;
  rowCount: number;
  rowLabel: string;
}

export interface BatchExtractionResult {
  objects: ExtractedObject[];
  metadata: BatchExtractionMetadata;
  detectedCriticals: string[];
}

export interface ToastItem {
  id: string;
  message: string;
  type: 'success' | 'error';
}

export type OutputViewMode = 'console' | 'table';
