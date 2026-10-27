(() => {
  if (globalThis.__relayDuoInstalled) return;
  globalThis.__relayDuoInstalled = true;
  const credentials = navigator.credentials;
  if (!credentials) return;
  const originalGet = credentials.get.bind(credentials);
  const originalCreate = credentials.create.bind(credentials);
  const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const decode = text => Uint8Array.from(atob(text), character => character.charCodeAt(0)).buffer;
  const urlId = text => text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const waiting = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'RELAY_DUO_RESPONSE') return;
    const pending = waiting.get(event.data.id);
    if (!pending) return;
    waiting.delete(event.data.id);
    if (event.data.success) pending.resolve(event.data.result);
    else pending.reject(new DOMException('Duo setup could not complete.', 'NotAllowedError'));
  });
  function request(type, data, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException('Request aborted', 'AbortError'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const abort = () => { waiting.delete(id); reject(new DOMException('Request aborted', 'AbortError')); };
      waiting.set(id, {
        resolve: value => { signal?.removeEventListener('abort', abort); resolve(value); },
        reject: error => { signal?.removeEventListener('abort', abort); reject(error); },
      });
      signal?.addEventListener('abort', abort, { once: true });
      window.postMessage({ type: 'RELAY_DUO_REQUEST', id, operation: type, request: { ...data, origin: location.origin } }, location.origin);
    });
  }
  if (globalThis.PublicKeyCredential) {
    const originalSupport = PublicKeyCredential.isExternalCTAP2SecurityKeySupported?.bind(PublicKeyCredential);
    PublicKeyCredential.isExternalCTAP2SecurityKeySupported = async () => {
      const result = await request('RELAY_CAPABILITIES', { rpId: 'duosecurity.com' });
      return result.softwareKey || (originalSupport ? originalSupport() : false);
    };
  }
  credentials.get = async options => {
    const key = options?.publicKey;
    if (!key || (key.rpId || location.hostname) !== 'duosecurity.com') return originalGet(options);
    const result = await request('DUO_AUTOPILOT_SIGN', {
      rpId: key.rpId || location.hostname, requestId: crypto.randomUUID(), challenge: encode(key.challenge),
      allowCredentials: (key.allowCredentials || []).map(entry => encode(entry.id)),
    }, options.signal);
    if (result.passThrough) return originalGet(options);
    if (!result.ok) throw new DOMException('Duo setup refused this key request.', 'NotAllowedError');
    const response = Object.assign(Object.create(AuthenticatorAssertionResponse.prototype), {
      clientDataJSON: decode(result.clientDataJSON), authenticatorData: decode(result.authenticatorData),
      signature: decode(result.signature), userHandle: result.userHandle ? decode(result.userHandle) : null,
    });
    return Object.assign(Object.create(PublicKeyCredential.prototype), {
      id: urlId(result.credentialId), rawId: decode(result.credentialId), type: 'public-key',
      authenticatorAttachment: result.transport === 'usb' ? 'cross-platform' : 'platform', response,
      getClientExtensionResults: () => ({}),
    });
  };
  credentials.create = async options => {
    const key = options?.publicKey;
    if (!key || (key.rp?.id || location.hostname) !== 'duosecurity.com') return originalCreate(options);
    const requestId = crypto.randomUUID();
    const result = await request('DUO_AUTOPILOT_ENROLL', {
      requestId, rpId: key.rp?.id || location.hostname, challenge: encode(key.challenge),
      userHandle: key.user?.id ? encode(key.user.id) : null, username: key.user?.name,
      pubKeyCredParams: key.pubKeyCredParams,
      authenticatorAttachment: key.authenticatorSelection?.authenticatorAttachment || null,
      residentKey: key.authenticatorSelection?.residentKey === 'required' || key.authenticatorSelection?.requireResidentKey === true,
    }, options.signal);
    if (result.native) {
      let credential;
      try {
        credential = await originalCreate(options);
        if (!credential || credential.authenticatorAttachment !== 'platform') throw new DOMException('A native platform credential is required.', 'NotAllowedError');
      } catch (error) {
        try { await request('RELAY_NATIVE_FAILED', { requestId, rpId: key.rp?.id || location.hostname }); }
        finally { throw error; }
      }
      await request('RELAY_NATIVE_CREATED', { requestId, rpId: key.rp?.id || location.hostname,
        credentialId: encode(credential.rawId), attachment: credential.authenticatorAttachment }, options.signal);
      return credential;
    }
    if (!result.ok) throw new DOMException('Duo setup refused enrollment.', 'NotAllowedError');
    const response = Object.assign(Object.create(AuthenticatorAttestationResponse.prototype), {
      clientDataJSON: decode(result.clientDataJSON), attestationObject: decode(result.attestationObject),
      getTransports: () => [result.transport], getAuthenticatorData: () => decode(result.authData),
      getPublicKey: () => decode(result.publicKeySpki), getPublicKeyAlgorithm: () => -7,
    });
    return Object.assign(Object.create(PublicKeyCredential.prototype), {
      id: urlId(result.credentialId), rawId: decode(result.credentialId), type: 'public-key',
      authenticatorAttachment: 'cross-platform', response, getClientExtensionResults: () => ({}),
    });
  };
})();
