(() => {
  const credentials = navigator.credentials;
  if (!credentials || typeof credentials.get !== 'function') return;
  const originalGet = credentials.get.bind(credentials);
  const encode = bytes => btoa(String.fromCharCode(...(ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes))));
  const decode = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0)).buffer;
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'DUO_WORKFLOW_RESPONSE') return;
    const request = pending.get(event.data.id);
    if (!request) return;
    if (event.data.success) request.resolve(event.data.result);
    else request.reject(new DOMException('Duo signing could not complete.', 'NotAllowedError'));
  });
  credentials.get = async options => {
    const key = options?.publicKey;
    if (!key || (key.rpId || location.hostname) !== 'duosecurity.com') return originalGet(options);
    if (options.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
    const id = crypto.randomUUID();
    const result = await new Promise((resolve, reject) => {
      let timer;
      const finish = (operation, value) => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); pending.delete(id); operation(value); };
      const abort = () => { window.postMessage({ type: 'DUO_WORKFLOW_ABORT', id }, location.origin); finish(reject, new DOMException('Request aborted', 'AbortError')); };
      pending.set(id, { resolve: value => finish(resolve, value), reject: error => finish(reject, error) });
      options.signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => { window.postMessage({ type: 'DUO_WORKFLOW_ABORT', id }, location.origin); finish(reject, new DOMException('Duo signing timed out.', 'NotAllowedError')); }, 15000);
      window.postMessage({ type: 'DUO_WORKFLOW_REQUEST', id, request: { requestId: id, rpId: key.rpId || location.hostname,
        origin: location.origin, challenge: encode(key.challenge), allowCredentials: (key.allowCredentials || []).map(entry => encode(entry.id)) } }, location.origin);
    });
    if (result?.passThrough === true) return originalGet(options);
    if (!result?.ok) throw new DOMException('Duo signing refused.', 'NotAllowedError');
    const response = Object.create(AuthenticatorAssertionResponse.prototype, Object.getOwnPropertyDescriptors({
      clientDataJSON: decode(result.clientDataJSON), authenticatorData: decode(result.authenticatorData), signature: decode(result.signature),
      userHandle: result.userHandle ? decode(result.userHandle) : null,
    }));
    return Object.create(PublicKeyCredential.prototype, Object.getOwnPropertyDescriptors({
      id: result.credentialId.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), rawId: decode(result.credentialId), type: 'public-key',
      authenticatorAttachment: result.transport === 'usb' ? 'cross-platform' : 'platform', response, getClientExtensionResults: () => ({}),
    }));
  };
})();
