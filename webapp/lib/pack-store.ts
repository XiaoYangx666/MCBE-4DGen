import type { SkinPack } from './pack-types.ts';

const DB_NAME = '4dgen-webapp';
const DB_VERSION = 1;
const STORE = 'state';
const KEY = 'skin-pack';

let connection: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined')
    return Promise.reject(new Error('当前浏览器不支持本地皮肤包存储（IndexedDB）'));
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        resolve(db);
      };
      request.onerror = () => {
        connection = null;
        reject(request.error ?? new Error('无法打开本地数据库'));
      };
      request.onblocked = () => {
        connection = null;
        reject(new Error('本地数据库被其他页面占用，请关闭其他 4DGen 网页后重试'));
      };
    });
  }
  return connection;
}

export async function loadSkinPack(): Promise<SkinPack | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readonly');
    const request = transaction.objectStore(STORE).get(KEY);
    request.onsuccess = () => {
      const value = request.result as SkinPack | undefined;
      if (!value || value.version !== 1 || !Array.isArray(value.skins)) {
        resolve(null);
        return;
      }
      resolve(value);
    };
    request.onerror = () => reject(request.error ?? new Error('读取皮肤包失败'));
  });
}

export async function saveSkinPack(pack: SkinPack): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(pack, KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('保存皮肤包失败'));
    transaction.onabort = () => reject(transaction.error ?? new Error('保存皮肤包已取消'));
  });
}

export async function deleteSkinPack(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('删除皮肤包失败'));
  });
}
