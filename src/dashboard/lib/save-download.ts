/** Bytes have already passed the typed client's identity, length and digest checks. */
export function saveDownload(download:{filename:string;mediaType:string;bytes:ArrayBuffer}):void {
  const url=URL.createObjectURL(new Blob([download.bytes],{type:download.mediaType}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download=download.filename;
  document.body.append(anchor);
  try {anchor.click();} finally {anchor.remove();window.setTimeout(()=>URL.revokeObjectURL(url),0);}
}
