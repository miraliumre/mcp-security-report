import { Writable } from 'stream';

export interface OutputOptions {
  stream?: Writable;
  format?: 'plain' | 'json';
}

export class OutputService {
  private stdout: Writable;
  private stderr: Writable;
  private format: 'plain' | 'json';

  constructor(options?: OutputOptions) {
    this.stdout = options?.stream ?? process.stdout;
    this.stderr = process.stderr;
    this.format = options?.format ?? 'plain';
  }

  write(message: string): void {
    this.stdout.write(message);
  }

  writeLine(message: string = ''): void {
    this.stdout.write(message + '\n');
  }

  writeError(message: string): void {
    this.stderr.write(message + '\n');
  }

  writeJson(data: unknown): void {
    const output =
      this.format === 'json'
        ? JSON.stringify(data, null, 2)
        : this.formatPlainOutput(data);
    this.writeLine(output);
  }

  writeTable(headers: string[], rows: string[][]): void {
    if (this.format === 'json') {
      const data = rows.map((row) => {
        const obj: Record<string, string> = {};
        headers.forEach((header, index) => {
          // eslint-disable-next-line security/detect-object-injection
          obj[header] = row[index] ?? '';
        });
        return obj;
      });
      this.writeJson(data);
      return;
    }

    const columnWidths = headers.map((header, i) => {
      const headerLength = header.length;
      const rowLengths = rows.map((row) => {
        // eslint-disable-next-line security/detect-object-injection
        const cell = row[i];
        return cell ? cell.length : 0;
      });
      return Math.max(headerLength, ...rowLengths);
    });

    const separator = columnWidths
      .map((width) => '-'.repeat(width + 2))
      .join('+');

    this.writeLine(separator);
    this.writeLine(
      '| ' +
        headers
          .map((header, i) => {
            // eslint-disable-next-line security/detect-object-injection
            const width = columnWidths[i];
            return width !== undefined ? header.padEnd(width) : header;
          })
          .join(' | ') +
        ' |'
    );
    this.writeLine(separator);

    rows.forEach((row) => {
      this.writeLine(
        '| ' +
          row
            .map((cell, i) => {
              // eslint-disable-next-line security/detect-object-injection
              const width = columnWidths[i];
              const content = cell ?? '';
              return width !== undefined ? content.padEnd(width) : content;
            })
            .join(' | ') +
          ' |'
      );
    });

    this.writeLine(separator);
  }

  writeBulletList(items: string[]): void {
    if (this.format === 'json') {
      this.writeJson(items);
      return;
    }

    items.forEach((item) => {
      this.writeLine(`• ${item}`);
    });
  }

  writeNumberedList(items: string[]): void {
    if (this.format === 'json') {
      this.writeJson(items);
      return;
    }

    items.forEach((item, index) => {
      this.writeLine(`${index + 1}. ${item}`);
    });
  }

  writeSuccess(message: string): void {
    if (this.format === 'json') {
      this.writeJson({ status: 'success', message });
    } else {
      this.writeLine(`✓ ${message}`);
    }
  }

  writeWarning(message: string): void {
    if (this.format === 'json') {
      this.writeJson({ status: 'warning', message });
    } else {
      this.writeLine(`⚠ ${message}`);
    }
  }

  writeErrorMessage(message: string): void {
    if (this.format === 'json') {
      this.writeJson({ status: 'error', message });
    } else {
      this.writeError(`✗ ${message}`);
    }
  }

  private formatPlainOutput(data: unknown): string {
    if (typeof data === 'string') {
      return data;
    }
    if (data === null || data === undefined) {
      return '';
    }
    if (typeof data === 'object') {
      if (Array.isArray(data)) {
        return data.map((item) => this.formatPlainOutput(item)).join('\n');
      }
      return Object.entries(data)
        .map(([key, value]) => `${key}: ${this.formatPlainOutput(value)}`)
        .join('\n');
    }
    if (typeof data === 'object' && data !== null) {
      return JSON.stringify(data);
    }
    if (typeof data === 'string') {
      return data;
    }
    if (typeof data === 'number' || typeof data === 'boolean') {
      return String(data);
    }
    if (typeof data === 'symbol') {
      return data.toString();
    }
    if (typeof data === 'function') {
      return `[Function: ${data.name || 'anonymous'}]`;
    }
    // Handle undefined, bigint, or any other edge cases
    if (data === undefined) {
      return 'undefined';
    }
    if (typeof data === 'bigint') {
      return data.toString();
    }
    // For any remaining edge cases, ensure safe stringification
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(data);
  }

  flush(): void {
    // Some writable streams support flush, check and call if available
    const stream = this.stdout as Writable & { flush?: () => void };
    if (stream.flush && typeof stream.flush === 'function') {
      stream.flush();
    }
  }
}

export const output = new OutputService();
