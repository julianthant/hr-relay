(() => {
  const nativeCreate = navigator.credentials?.create?.bind(navigator.credentials);
  const encode = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const base64url = text => text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const equal = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
  globalThis.RelayNative = Object.freeze({
    async create(publicKey, expected, signal) {
      if (!nativeCreate || publicKey.authenticatorSelection?.authenticatorAttachment !== 'platform') throw new Error('ONBOARDING_DUO_NATIVE_UNAVAILABLE');
      if (publicKey.rp?.id !== expected.rpId || encode(publicKey.challenge) !== expected.challenge
        || publicKey.user?.name !== expected.username || encode(publicKey.user.id) !== expected.userHandle || signal.aborted) throw new Error('ONBOARDING_DUO_SCOPE');
      const credential = await nativeCreate({ publicKey, signal });
      if (!(credential instanceof PublicKeyCredential) || !(credential.response instanceof AuthenticatorAttestationResponse)
        || credential.authenticatorAttachment !== 'platform' || signal.aborted) throw new Error('ONBOARDING_DUO_NATIVE_UNAVAILABLE');
      const response = credential.response;
      const clientData = JSON.parse(new TextDecoder().decode(response.clientDataJSON));
      if (clientData.type !== 'webauthn.create' || clientData.origin !== expected.origin || clientData.crossOrigin === true
        || clientData.challenge !== base64url(expected.challenge)) throw new Error('ONBOARDING_DUO_NATIVE_ORIGIN');
      const authData = response.getAuthenticatorData();
      const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected.rpId)));
      if (!equal(new Uint8Array(authData).slice(0, 32), rpHash) || signal.aborted) throw new Error('ONBOARDING_DUO_SCOPE');
      const publicKeySpki = response.getPublicKey();
      return { credentialId: encode(credential.rawId), attachment: credential.authenticatorAttachment,
        clientDataJSON: encode(response.clientDataJSON), attestationObject: encode(response.attestationObject),
        authData: encode(authData), publicKeySpki: publicKeySpki === null ? null : encode(publicKeySpki),
        publicKeyAlgorithm: response.getPublicKeyAlgorithm(), transports: response.getTransports() };
    },
  });
})();
