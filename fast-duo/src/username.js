// Shared by the isolated content script and fixture tests. Exact visible username
// lines and explicit username fields only; no arbitrary substring/page-script scraping.
(function (root) {
  function findUsernames(document) {
    const values = [];
    for (const el of document.querySelectorAll('input[autocomplete="username"], input[name="username"], input[name="user"]')) {
      if (el.getClientRects().length && el.value) values.push(el.value.trim());
    }
    const lines = (document.body?.innerText || '').split('\n').map(s => s.trim());
    for (let i = 0; i < lines.length; i++) {
      const match = /^(?:username|signed in as|logging in as|account)\s*:\s*([a-z0-9][a-z0-9._@+-]{0,127})$/i.exec(lines[i]);
      if (match) values.push(match[1]);
      if (/^username\s*:$/i.test(lines[i]) && /^[a-z0-9][a-z0-9._@+-]{0,127}$/i.test(lines[i+1] || '')) values.push(lines[i+1]);
    }
    return [...new Set(values.map(s => s.toLowerCase()))];
  }
  root.DuoUsername = { findUsernames };
})(globalThis);
