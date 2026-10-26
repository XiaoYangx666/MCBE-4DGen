import { downloadBlob, zipFileName } from "../shared/file-save";

export type SaveResult = { saved: boolean; path?: string };

type Writable = {
  write(data: BlobPart): Promise<void>;
  close(): Promise<void>;
};
type FilePicker = (options: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}) => Promise<{ name: string; createWritable(): Promise<Writable> }>;

/**
 * Save ZIP bytes where the user chooses. Desktop asks for a folder and writes
 * the file; browsers with the File System Access API get a file picker;
 * otherwise the normal download flow is used.
 */
export async function saveZip(
  bytes: Uint8Array,
  name: string,
): Promise<SaveResult> {
  const filename = zipFileName(name, "game-skin-pack");
  if (window.desktop?.saveFile) {
    const result = await window.desktop.saveFile(filename, bytes);
    return result.path ? { saved: true, path: result.path } : { saved: false };
  }
  const download = (): SaveResult => {
    downloadBlob(
      new Blob([bytes as unknown as BlobPart], { type: "application/zip" }),
      filename,
    );
    return { saved: true };
  };
  const picker = (
    window as unknown as { showSaveFilePicker?: FilePicker }
  ).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: "皮肤包 ZIP",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(bytes as unknown as BlobPart);
      await writable.close();
      return { saved: true, path: handle.name };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        return { saved: false };
      // The picker can be unavailable or reject after an async fetch; the
      // normal download flow still saves the ZIP.
      return download();
    }
  }
  return download();
}
