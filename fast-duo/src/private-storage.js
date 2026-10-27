// Safari's storage.local is visible to content scripts and cannot be restricted.
// IndexedDB opened by the extension background belongs to the extension origin,
// while content scripts' web storage belongs to the host page origin.
const LEGACY_KEYS = ['autopilotV1', 'duoCredentials', 'settings', 'enroll'];

export function createIndexedStorage(indexedDB, databaseName = 'duo-autopilot-private') {
  let connection;
  const open = () => connection ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let failed = false;
    request.onupgradeneeded = () => request.result.createObjectStore('values');
    request.onerror = () => { failed = true; reject(new Error('Safari private storage could not open. Existing keys were preserved.')); };
    request.onblocked = () => { failed = true; reject(new Error('Safari private storage is blocked. Close other extension settings pages and retry.')); };
    request.onsuccess = () => {
      const database = request.result;
      if (failed) { database.close(); return; }
      database.onversionchange = () => { database.close(); connection = undefined; };
      resolve(database);
    };
  });
  async function transaction(mode, operate) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('values', mode);
      const results = {};
      tx.oncomplete = () => resolve(results);
      tx.onabort = () => reject(new Error('Safari private storage transaction failed. No success was reported.'));
      tx.onerror = () => { /* Transaction abort owns the failure; never resolve on a request alone. */ };
      try { operate(tx.objectStore('values'), results); }
      catch (error) { tx.abort(); reject(error); }
    });
  }
  return {
    get: keys => transaction('readonly', (store, results) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        const request = store.get(key);
        request.onsuccess = () => { if (request.result !== undefined) results[key] = request.result; };
      }
    }),
    set: values => transaction('readwrite', store => {
      for (const [key, value] of Object.entries(values)) store.put(value, key);
    }),
    remove: keys => transaction('readwrite', store => {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    }),
  };
}

export async function migrateSafariStorage(local, privateStorage) {
  const previous = await local.get(LEGACY_KEYS);
  const existing = await privateStorage.get(LEGACY_KEYS);
  const copy = {};
  for (const key of LEGACY_KEYS) {
    if (previous[key] === undefined) continue;
    if (existing[key] !== undefined && JSON.stringify(existing[key]) !== JSON.stringify(previous[key])) {
      throw new Error('Safari storage migration found conflicting data. Both copies were preserved.');
    }
    copy[key] = previous[key];
  }
  if (!Object.keys(copy).length) return;
  await privateStorage.set(copy);
  const verified = await privateStorage.get(Object.keys(copy));
  for (const key of Object.keys(copy)) {
    if (JSON.stringify(verified[key]) !== JSON.stringify(copy[key])) throw new Error('Safari storage migration verification failed. Original data was preserved.');
  }
  await local.remove(Object.keys(copy));
  const remaining = await local.get(Object.keys(copy));
  if (Object.keys(copy).some(key => remaining[key] !== undefined)) throw new Error('Safari storage migration could not remove the old copy. Retry before using Autopilot.');
}

export async function preparePrivateStorage(api, indexedDB = globalThis.indexedDB) {
  const local = api.storage.local;
  if (api.runtime.getURL('').startsWith('safari-web-extension://')) {
    if (!indexedDB) throw new Error('Safari IndexedDB is unavailable. Keys will not be stored in unprotected extension storage.');
    const privateStorage = createIndexedStorage(indexedDB);
    await migrateSafariStorage(local, privateStorage);
    return privateStorage;
  }
  if (typeof local.setAccessLevel !== 'function') throw new Error('This browser lacks protected local storage. Use a current Chrome release or Safari.');
  await local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  return local;
}
