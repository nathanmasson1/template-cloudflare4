type ZipSource = ReadableStream<Uint8Array> | Uint8Array | ArrayBuffer | string | null;

export interface ZipSourceEntry {
  path: string;
  modifiedAt?: Date;
  open: () => Promise<ZipSource> | ZipSource;
}

export interface ZipParsedEntry {
  path: string;
  bytes: Uint8Array;
  crc32: number;
}

interface CentralEntry {
  pathBytes: Uint8Array;
  modifiedAt: Date;
  crc32: number;
  size: number;
  offset: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const UTF8_FLAG = 0x0800;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ZIP_STORE_METHOD = 0;
const MAX_ZIP32_SIZE = 0xffffffff;

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function updateCrc(rawCrc: number, bytes: Uint8Array) {
  let c = rawCrc;
  for (let i = 0; i < bytes.length; i++) {
    c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return c >>> 0;
}

function finishCrc(rawCrc: number) {
  return (rawCrc ^ 0xffffffff) >>> 0;
}

function normalizeZipPath(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').includes('..')) {
    throw new Error(`Caminho inválido no backup: ${path}`);
  }
  return normalized;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { dosDate, dosTime };
}

function writeU16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function writeU32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value >>> 0, true);
}

function readU16(view: DataView, offset: number) {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number) {
  return view.getUint32(offset, true);
}

function localFileHeader(pathBytes: Uint8Array, modifiedAt: Date) {
  const { dosDate, dosTime } = dosDateTime(modifiedAt);
  const bytes = new Uint8Array(30 + pathBytes.length);
  const view = new DataView(bytes.buffer);
  writeU32(view, 0, 0x04034b50);
  writeU16(view, 4, 20);
  writeU16(view, 6, DATA_DESCRIPTOR_FLAG | UTF8_FLAG);
  writeU16(view, 8, ZIP_STORE_METHOD);
  writeU16(view, 10, dosTime);
  writeU16(view, 12, dosDate);
  writeU32(view, 14, 0);
  writeU32(view, 18, 0);
  writeU32(view, 22, 0);
  writeU16(view, 26, pathBytes.length);
  writeU16(view, 28, 0);
  bytes.set(pathBytes, 30);
  return bytes;
}

function dataDescriptor(crc32: number, size: number) {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  writeU32(view, 0, 0x08074b50);
  writeU32(view, 4, crc32);
  writeU32(view, 8, size);
  writeU32(view, 12, size);
  return bytes;
}

function centralDirectoryHeader(entry: CentralEntry) {
  const { dosDate, dosTime } = dosDateTime(entry.modifiedAt);
  const bytes = new Uint8Array(46 + entry.pathBytes.length);
  const view = new DataView(bytes.buffer);
  writeU32(view, 0, 0x02014b50);
  writeU16(view, 4, 20);
  writeU16(view, 6, 20);
  writeU16(view, 8, DATA_DESCRIPTOR_FLAG | UTF8_FLAG);
  writeU16(view, 10, ZIP_STORE_METHOD);
  writeU16(view, 12, dosTime);
  writeU16(view, 14, dosDate);
  writeU32(view, 16, entry.crc32);
  writeU32(view, 20, entry.size);
  writeU32(view, 24, entry.size);
  writeU16(view, 28, entry.pathBytes.length);
  writeU16(view, 30, 0);
  writeU16(view, 32, 0);
  writeU16(view, 34, 0);
  writeU16(view, 36, 0);
  writeU32(view, 38, 0);
  writeU32(view, 42, entry.offset);
  bytes.set(entry.pathBytes, 46);
  return bytes;
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  writeU32(view, 0, 0x06054b50);
  writeU16(view, 4, 0);
  writeU16(view, 6, 0);
  writeU16(view, 8, entryCount);
  writeU16(view, 10, entryCount);
  writeU32(view, 12, centralSize);
  writeU32(view, 16, centralOffset);
  writeU16(view, 20, 0);
  return bytes;
}

async function* sourceChunks(source: ZipSource): AsyncGenerator<Uint8Array> {
  if (source === null) return;
  if (typeof source === 'string') {
    yield encoder.encode(source);
    return;
  }
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  if (source instanceof ArrayBuffer) {
    yield new Uint8Array(source);
    return;
  }

  const reader = source.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function assertZip32(value: number, label: string) {
  if (value > MAX_ZIP32_SIZE) throw new Error(`${label} excede o limite ZIP32.`);
}

export function createStoredZipStream(entries: ZipSourceEntry[]) {
  const safeEntries = entries.map((entry) => ({
    ...entry,
    path: normalizeZipPath(entry.path),
    modifiedAt: entry.modifiedAt || new Date(),
  }));

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let offset = 0;
      const central: CentralEntry[] = [];

      for (const entry of safeEntries) {
        const pathBytes = encoder.encode(entry.path);
        const localHeader = localFileHeader(pathBytes, entry.modifiedAt);
        const entryOffset = offset;
        controller.enqueue(localHeader);
        offset += localHeader.length;

        let rawCrc = 0xffffffff;
        let size = 0;
        const source = await entry.open();

        for await (const chunk of sourceChunks(source)) {
          rawCrc = updateCrc(rawCrc, chunk);
          size += chunk.length;
          assertZip32(size, entry.path);
          controller.enqueue(chunk);
          offset += chunk.length;
        }

        const crc32 = finishCrc(rawCrc);
        const descriptor = dataDescriptor(crc32, size);
        controller.enqueue(descriptor);
        offset += descriptor.length;

        central.push({
          pathBytes,
          modifiedAt: entry.modifiedAt,
          crc32,
          size,
          offset: entryOffset,
        });
      }

      const centralOffset = offset;
      let centralSize = 0;
      for (const entry of central) {
        const header = centralDirectoryHeader(entry);
        controller.enqueue(header);
        offset += header.length;
        centralSize += header.length;
      }

      assertZip32(centralOffset, 'Offset do diretório central');
      assertZip32(centralSize, 'Diretorio central');
      controller.enqueue(endOfCentralDirectory(central.length, centralSize, centralOffset));
      controller.close();
    },
  });
}

export function createStoredZipResponse(entries: ZipSourceEntry[], filename: string) {
  return new Response(createStoredZipStream(entries), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

function findEndOfCentralDirectory(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 65557);
  for (let offset = bytes.length - 22; offset >= min; offset--) {
    if (readU32(view, offset) === 0x06054b50) return offset;
  }
  throw new Error('Arquivo ZIP inválido: diretório central não encontrado.');
}

export function parseStoredZip(buffer: ArrayBuffer): ZipParsedEntry[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const entryCount = readU16(view, eocdOffset + 10);
  const centralOffset = readU32(view, eocdOffset + 16);
  const entries: ZipParsedEntry[] = [];
  let offset = centralOffset;

  for (let i = 0; i < entryCount; i++) {
    if (readU32(view, offset) !== 0x02014b50) {
      throw new Error('Arquivo ZIP inválido: entrada central corrompida.');
    }

    const method = readU16(view, offset + 10);
    if (method !== ZIP_STORE_METHOD) {
      throw new Error('Este backup usa um ZIP comprimido que não é suportado. Use backups gerados por este plugin.');
    }

    const crc32 = readU32(view, offset + 16);
    const compressedSize = readU32(view, offset + 20);
    const fileNameLength = readU16(view, offset + 28);
    const extraLength = readU16(view, offset + 30);
    const commentLength = readU16(view, offset + 32);
    const localHeaderOffset = readU32(view, offset + 42);
    const path = normalizeZipPath(decoder.decode(bytes.subarray(offset + 46, offset + 46 + fileNameLength)));
    offset += 46 + fileNameLength + extraLength + commentLength;

    if (path.endsWith('/')) continue;
    if (readU32(view, localHeaderOffset) !== 0x04034b50) {
      throw new Error(`Arquivo ZIP inválido: cabeçalho local ausente em ${path}.`);
    }

    const localNameLength = readU16(view, localHeaderOffset + 26);
    const localExtraLength = readU16(view, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw new Error(`Arquivo ZIP inválido: conteúdo incompleto em ${path}.`);

    const entryBytes = bytes.subarray(dataStart, dataEnd);
    const actualCrc = finishCrc(updateCrc(0xffffffff, entryBytes));
    if (actualCrc !== crc32) throw new Error(`CRC inválido em ${path}.`);
    entries.push({ path, bytes: entryBytes, crc32 });
  }

  return entries;
}
