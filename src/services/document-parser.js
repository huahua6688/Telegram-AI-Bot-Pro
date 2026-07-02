import path from 'node:path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import readXlsxFile from 'read-excel-file/node';
import { truncateText } from '../utils/text.js';

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
  'application/xml',
  'text/xml'
]);

const EXTENSION_TO_KIND = {
  txt: 'text',
  md: 'text',
  markdown: 'text',
  json: 'text',
  csv: 'text',
  xml: 'text',
  pdf: 'pdf',
  docx: 'docx',
  xlsx: 'xlsx'
};

function chunkText(text, chunkSize) {
  if (!text) return [];
  const chunks = [];
  let cursor = 0;
  while (cursor < text.length) {
    chunks.push(text.slice(cursor, cursor + chunkSize).trim());
    cursor += chunkSize;
  }
  return chunks.filter(Boolean);
}

function resolveKind({ filename = '', mimeType = '' }) {
  const ext = path.extname(filename).replace('.', '').toLowerCase();
  if (EXTENSION_TO_KIND[ext]) return { kind: EXTENSION_TO_KIND[ext], extension: ext };
  if (TEXT_MIME_TYPES.has(mimeType)) return { kind: 'text', extension: ext };
  if (mimeType === 'application/pdf') return { kind: 'pdf', extension: ext || 'pdf' };
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return { kind: 'docx', extension: ext || 'docx' };
  }
  if (
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return { kind: 'xlsx', extension: ext || 'xlsx' };
  }
  return { kind: '', extension: ext };
}

async function parsePdf(buffer) {
  const result = await pdfParse(buffer);
  return String(result.text || '').trim();
}

async function parseDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return String(result.value || '').trim();
}

async function parseXlsx(buffer) {
  const sheets = await readXlsxFile(buffer, { getSheets: true });
  const lines = [];
  for (const sheet of sheets) {
    lines.push(`# Sheet: ${sheet.name}`);
    const rows = await readXlsxFile(buffer, { sheet: sheet.name });
    for (const row of rows) {
      const values = row.map((value) => (value === null || value === undefined ? '' : String(value))).join('\t').trimEnd();
      if (values) lines.push(values);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

export class DocumentParser {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
  }

  async parse({ buffer, filename = '', mimeType = '' }) {
    const sizeBytes = buffer?.length || 0;
    if (sizeBytes > this.config.documentMaxBytes) {
      return {
        ok: false,
        error: {
          code: 'DOCUMENT_TOO_LARGE',
          message: `File is too large (${sizeBytes} bytes > ${this.config.documentMaxBytes} bytes).`
        },
        meta: { filename, mimeType, sizeBytes }
      };
    }

    const { kind, extension } = resolveKind({ filename, mimeType });
    if (!kind) {
      return {
        ok: false,
        error: {
          code: 'DOCUMENT_TYPE_UNSUPPORTED',
          message: `Unsupported document type: ${mimeType || extension || 'unknown'}.`
        },
        meta: { filename, mimeType, extension, sizeBytes }
      };
    }

    try {
      let text = '';
      if (kind === 'text') {
        text = buffer.toString('utf8');
      } else if (kind === 'pdf') {
        text = await parsePdf(buffer);
      } else if (kind === 'docx') {
        text = await parseDocx(buffer);
      } else if (kind === 'xlsx') {
        text = await parseXlsx(buffer);
      }

      const normalizedText = truncateText(String(text || '').trim(), this.config.documentMaxChars);
      const chunks = chunkText(normalizedText, this.config.documentChunkChars);
      return {
        ok: true,
        text: normalizedText,
        chunks,
        meta: {
          filename,
          mimeType,
          extension,
          parser: kind,
          sizeBytes,
          truncated: normalizedText.length < String(text || '').trim().length,
          chunkCount: chunks.length
        }
      };
    } catch (error) {
      this.logger.warn('Document parse failed', {
        filename,
        mimeType,
        error: error.message
      });
      return {
        ok: false,
        error: {
          code: 'DOCUMENT_PARSE_FAILED',
          message: error.message
        },
        meta: { filename, mimeType, extension, sizeBytes }
      };
    }
  }
}
